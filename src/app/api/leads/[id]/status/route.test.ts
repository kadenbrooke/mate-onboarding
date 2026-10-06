import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, seedTenants, USERS, TENANT_A, TENANT_B, DEMO, type FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => h.db.client }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));

import { PATCH } from './route';

const req = (body: unknown) => new Request('http://x', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const call = (leadId: string, body: unknown) => PATCH(req(body) as never, { params: Promise.resolve({ id: leadId }) });

beforeEach(() => {
  h.db = createFakeDb(seedTenants());
  h.user = USERS.memberA;
});

describe('PATCH /api/leads/[id]/status', () => {
  it('rejects invalid status with 400', async () => {
    expect((await call('lead-a', { status: 'banana', session_id: TENANT_A })).status).toBe(400);
  });

  it('returns 400 for unparseable body', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: 'not-json' }) as never, { params: Promise.resolve({ id: 'lead-a' }) });
    expect(res.status).toBe(400);
  });

  it('401s an anonymous caller on a real tenant', async () => {
    h.user = null;
    const res = await call('lead-a', { status: 'serviced', session_id: TENANT_A });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Sign in required.');
    expect(h.db.writes).toEqual([]);
  });

  it('403s a signed-in member of a different tenant (IDOR)', async () => {
    h.user = USERS.memberB;
    expect((await call('lead-a', { status: 'serviced', session_id: TENANT_A })).status).toBe(403);
    // Naming their own session does not help: the tenant comes from the lead row.
    expect((await call('lead-a', { status: 'serviced', session_id: TENANT_B })).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });

  it('updates status scoped to the lead row session for a member', async () => {
    const res = await call('lead-a', { status: 'quoted', session_id: TENANT_A });
    expect(res.status).toBe(200);
    expect(h.db.writes).toEqual([{ table: 'client_leads', op: 'update', values: { status: 'quoted' }, filters: [['id', 'lead-a'], ['session_id', TENANT_A]] }]);
  });

  it('keeps demo sessions open for the public Instant Demo flow', async () => {
    h.user = null;
    expect((await call('lead-demo', { status: 'serviced', session_id: DEMO })).status).toBe(200);
  });

  it('404s an unknown lead', async () => {
    expect((await call('ghost', { status: 'serviced' })).status).toBe(404);
  });
});
