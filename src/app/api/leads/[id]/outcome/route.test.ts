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

const WON = { outcome: 'won', job_value_cents: 640000, collected_cents: 320000, session_id: TENANT_A };

beforeEach(() => {
  h.db = createFakeDb(seedTenants());
  h.user = USERS.memberA;
});

describe('PATCH /api/leads/[id]/outcome', () => {
  it('returns 400 for unparseable body', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: 'not-json' }) as never, { params: Promise.resolve({ id: 'lead-a' }) });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid outcome, never touching status values', async () => {
    for (const outcome of ['serviced', 'banana', 'WON', 1]) {
      expect((await call('lead-a', { outcome, session_id: TENANT_A })).status).toBe(400);
    }
    expect((await call('lead-a', { session_id: TENANT_A })).status).toBe(400);
    expect(h.db.writes).toEqual([]);
  });

  it('rejects money on a lost job and bad amounts with 400', async () => {
    expect((await call('lead-a', { outcome: 'lost', collected_cents: 100 })).status).toBe(400);
    expect((await call('lead-a', { outcome: 'won', collected_cents: -1 })).status).toBe(400);
    expect((await call('lead-a', { outcome: 'won', job_value_cents: 12.5 })).status).toBe(400);
    expect((await call('lead-a', { outcome: 'won', lost_reason: 'price' })).status).toBe(400);
    expect(h.db.writes).toEqual([]);
  });

  it('401s an anonymous caller on a real tenant', async () => {
    h.user = null;
    const res = await call('lead-a', WON);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Sign in required.');
    expect(h.db.writes).toEqual([]);
  });

  it('403s a signed-in member of a different tenant (IDOR)', async () => {
    h.user = USERS.memberB;
    expect((await call('lead-a', WON)).status).toBe(403);
    // Naming their own session does not help: the tenant comes from the lead row.
    expect((await call('lead-a', { ...WON, session_id: TENANT_B })).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });

  it('404s when the body names another tenant than the lead row', async () => {
    expect((await call('lead-a', { ...WON, session_id: TENANT_B })).status).toBe(404);
    expect(h.db.writes).toEqual([]);
  });

  it('never writes on a demo dashboard, signed in or not', async () => {
    h.user = null;
    expect((await call('lead-demo', { ...WON, session_id: DEMO })).status).toBe(403);
    h.user = USERS.memberA;
    expect((await call('lead-demo', { ...WON, session_id: DEMO })).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });

  it('404s an unknown lead', async () => {
    expect((await call('ghost', WON)).status).toBe(404);
  });

  it('records a won job for a member, scoped to the lead row session, status untouched', async () => {
    const res = await call('lead-a', WON);
    expect(res.status).toBe(200);
    expect(h.db.writes).toEqual([{
      table: 'client_leads', op: 'update',
      values: {
        job_outcome: 'won', job_value_cents: 640000, collected_cents: 320000, lost_reason: null,
        outcome_recorded_by: USERS.memberA.id,
      },
      filters: [['id', 'lead-a'], ['session_id', TENANT_A]],
    }]);
  });

  it('lets an internal Mate user record a lost job with a reason', async () => {
    h.user = USERS.internal;
    const res = await call('lead-b', { outcome: 'lost', lost_reason: '  went with a cheaper bid  ' });
    expect(res.status).toBe(200);
    expect(h.db.writes).toEqual([{
      table: 'client_leads', op: 'update',
      values: {
        job_outcome: 'lost', job_value_cents: null, collected_cents: null, lost_reason: 'went with a cheaper bid',
        outcome_recorded_by: USERS.internal.id,
      },
      filters: [['id', 'lead-b'], ['session_id', TENANT_B]],
    }]);
  });

  it('clears every outcome field at once', async () => {
    const res = await call('lead-a', { outcome: null, session_id: TENANT_A });
    expect(res.status).toBe(200);
    expect(h.db.writes).toEqual([{
      table: 'client_leads', op: 'update',
      values: { job_outcome: null, job_value_cents: null, collected_cents: null, lost_reason: null, outcome_recorded_by: null },
      filters: [['id', 'lead-a'], ['session_id', TENANT_A]],
    }]);
  });
});
