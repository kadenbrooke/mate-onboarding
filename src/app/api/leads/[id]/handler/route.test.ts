import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, seedTenants, USERS, TENANT_A, TENANT_B, type FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => h.db.client }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));

import { PATCH } from './route';

const req = (b: unknown) => new Request('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const call = (leadId: string, body: unknown) => PATCH(req(body) as never, { params: Promise.resolve({ id: leadId }) });

beforeEach(() => {
  h.db = createFakeDb(seedTenants());
  h.user = USERS.memberA;
});

describe('PATCH /api/leads/[id]/handler', () => {
  it('rejects a bad handler value', async () => {
    expect((await call('lead-a', { handler: 'robot', session_id: TENANT_A })).status).toBe(400);
  });

  it('401s an anonymous caller on a real tenant', async () => {
    h.user = null;
    expect((await call('lead-a', { handler: 'agent', session_id: TENANT_A })).status).toBe(401);
    expect(h.db.writes).toEqual([]);
  });

  it('403s a member of a different tenant, even naming their own session', async () => {
    h.user = USERS.memberB;
    expect((await call('lead-a', { handler: 'human', session_id: TENANT_A })).status).toBe(403);
    expect((await call('lead-a', { handler: 'human', session_id: TENANT_B })).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });

  it('sets handler=agent scoped to the lead row session for a member', async () => {
    const res = await call('lead-a', { handler: 'agent', session_id: TENANT_A });
    expect(res.status).toBe(200);
    expect(h.db.writes).toHaveLength(1);
    expect(h.db.writes[0].values).toEqual(expect.objectContaining({ handler: 'agent', handler_changed_by: 'dashboard' }));
    expect(h.db.writes[0].filters).toEqual([['id', 'lead-a'], ['session_id', TENANT_A]]);
  });

  it('404s when the body session_id does not match the lead', async () => {
    expect((await call('lead-a', { handler: 'agent', session_id: TENANT_B })).status).toBe(404);
    expect(h.db.writes).toEqual([]);
  });

  it('allows an internal user', async () => {
    h.user = USERS.internal;
    expect((await call('lead-b', { handler: 'human' })).status).toBe(200);
  });
});
