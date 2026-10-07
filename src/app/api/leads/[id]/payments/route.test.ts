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

import { POST } from './route';
import { DELETE } from './[paymentId]/route';

const post = (leadId: string, body: unknown) => POST(new Request('http://x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as never, { params: Promise.resolve({ id: leadId }) });
const del = (leadId: string, paymentId: string, sessionId?: string) => DELETE(
  new Request(`http://x/?${sessionId ? `session_id=${sessionId}` : ''}`, { method: 'DELETE' }) as never,
  { params: Promise.resolve({ id: leadId, paymentId }) },
);

const PAY = { amount_cents: 100000, paid_at: '2026-10-01T18:00:00.000Z', session_id: TENANT_A };

beforeEach(() => {
  h.db = createFakeDb(seedTenants());
  // Invented practice rows: lead-a is a won job, lead-b (tenant B) too.
  for (const l of h.db.tables.client_leads) if (l.id !== 'lead-demo') l.job_outcome = 'won';
  h.db.tables.client_lead_payments = [
    { id: 'pay-a', lead_id: 'lead-a', session_id: TENANT_A, amount_cents: 500000 },
    { id: 'pay-b', lead_id: 'lead-b', session_id: TENANT_B, amount_cents: 500000 },
  ];
  h.user = USERS.memberA;
});

describe('POST /api/leads/[id]/payments', () => {
  it('records one payment with its own date and who entered it, tenant from the lead row', async () => {
    const res = await post('lead-a', PAY);
    expect(res.status).toBe(200);
    expect(h.db.writes).toEqual([{
      table: 'client_lead_payments', op: 'insert',
      values: { lead_id: 'lead-a', session_id: TENANT_A, amount_cents: 100000, paid_at: '2026-10-01T18:00:00.000Z', recorded_by: USERS.memberA.id },
      filters: [],
    }]);
  });

  it('records a refund as a negative amount', async () => {
    expect((await post('lead-a', { ...PAY, amount_cents: -25000 })).status).toBe(200);
    expect((h.db.writes[0].values as { amount_cents: number }).amount_cents).toBe(-25000);
  });

  it('defaults the date to now', async () => {
    expect((await post('lead-a', { amount_cents: 100 })).status).toBe(200);
    const at = Date.parse((h.db.writes[0].values as { paid_at: string }).paid_at);
    expect(Math.abs(at - Date.now())).toBeLessThan(60_000);
  });

  it('400s a bad amount or date without writing', async () => {
    for (const body of [
      { amount_cents: 0 }, { amount_cents: 12.5 }, { amount_cents: '100' }, {},
      { amount_cents: 100, paid_at: 'yesterday' },
      { amount_cents: 100, paid_at: new Date(Date.now() + 3 * 86400000).toISOString() },
    ]) {
      expect((await post('lead-a', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(h.db.writes).toEqual([]);
  });

  it('409s a payment on a job not marked won', async () => {
    h.db.tables.client_leads.find(l => l.id === 'lead-a')!.job_outcome = null;
    const res = await post('lead-a', PAY);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/won/);
    expect(h.db.writes).toEqual([]);
  });

  it('401s an anonymous caller and 403s another tenant (IDOR), writing nothing', async () => {
    h.user = null;
    expect((await post('lead-a', PAY)).status).toBe(401);
    h.user = USERS.memberB;
    expect((await post('lead-a', PAY)).status).toBe(403);
    expect((await post('lead-a', { ...PAY, session_id: TENANT_B })).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });

  it('404s a body that names another tenant than the lead row, and an unknown lead', async () => {
    expect((await post('lead-a', { ...PAY, session_id: TENANT_B })).status).toBe(404);
    expect((await post('ghost', PAY)).status).toBe(404);
    expect(h.db.writes).toEqual([]);
  });

  it('never writes on a demo dashboard', async () => {
    h.user = null;
    expect((await post('lead-demo', { ...PAY, session_id: DEMO })).status).toBe(403);
    h.user = USERS.memberA;
    expect((await post('lead-demo', { ...PAY, session_id: DEMO })).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });
});

describe('DELETE /api/leads/[id]/payments/[paymentId]', () => {
  it('removes a payment scoped to the lead and the lead row tenant', async () => {
    const res = await del('lead-a', 'pay-a', TENANT_A);
    expect(res.status).toBe(200);
    expect(h.db.writes).toEqual([{
      table: 'client_lead_payments', op: 'delete', values: undefined,
      filters: [['id', 'pay-a'], ['lead_id', 'lead-a'], ['session_id', TENANT_A]],
    }]);
  });

  it('404s a payment id from another lead or tenant', async () => {
    expect((await del('lead-a', 'pay-b', TENANT_A)).status).toBe(404);
  });

  it('401s anonymous, 403s another tenant and demo', async () => {
    h.user = null;
    expect((await del('lead-a', 'pay-a')).status).toBe(401);
    expect((await del('lead-demo', 'pay-a', DEMO)).status).toBe(403);
    h.user = USERS.memberB;
    expect((await del('lead-a', 'pay-a')).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });
});
