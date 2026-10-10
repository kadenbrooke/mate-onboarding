import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, seedTenants, USERS, TENANT_A, TENANT_B, PRACTICE, type FakeDb } from '@/test/fakeSupabase';

// Real gates run (lead-gate -> api-gate -> dash-access) against an in-memory DB;
// only the Supabase clients and the Telnyx sender are faked.
const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => h.db.client }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
const sendSmsMock = vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string });
vi.mock('@/lib/agent/telnyx', () => ({ sendSms: (...a: unknown[]) => sendSmsMock(...a) }));

import { POST } from './route';

const req = (body: unknown) => new Request('http://x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const call = (leadId: string, body: unknown) => POST(req(body) as never, { params: Promise.resolve({ id: leadId }) });

beforeEach(() => {
  h.db = createFakeDb(seedTenants());
  h.user = USERS.memberA;
  sendSmsMock.mockReset();
  sendSmsMock.mockResolvedValue({ ok: true });
});

describe('POST /api/leads/[id]/reply', () => {
  it('rejects an empty body with 400', async () => {
    expect((await call('lead-a', { session_id: TENANT_A })).status).toBe(400);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('401s an anonymous caller and sends nothing', async () => {
    h.user = null;
    const res = await call('lead-a', { session_id: TENANT_A, text: 'hi' });
    expect(res.status).toBe(401);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(h.db.writes).toEqual([]);
  });

  it('403s a signed-in member of a different tenant (cross-tenant IDOR)', async () => {
    h.user = USERS.memberB;
    const res = await call('lead-a', { session_id: TENANT_A, text: 'hi' });
    expect(res.status).toBe(403);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(h.db.writes).toEqual([]);
  });

  it('derives the tenant from the lead row: a forged session_id cannot reach another tenant', async () => {
    h.user = USERS.memberB;
    // Attacker names their OWN session but someone else's lead id.
    const res = await call('lead-a', { session_id: TENANT_B, text: 'hi' });
    expect(res.status).toBe(403);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('404s when the body session_id does not match the lead row', async () => {
    const res = await call('lead-a', { session_id: TENANT_B, text: 'hi' });
    expect(res.status).toBe(404);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('refuses to send for a demo session, even anonymously', async () => {
    h.user = null;
    const res = await call('lead-demo', { text: 'hi' });
    expect(res.status).toBe(403);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('refuses to send for a real tenant not wired in intakeTenants', async () => {
    h.user = USERS.memberB;
    const res = await call('lead-b', { session_id: TENANT_B, text: 'hi' });
    expect(res.status).toBe(403);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('sends, logs, and takes over for a member of the lead tenant', async () => {
    const res = await call('lead-a', { session_id: TENANT_A, text: 'hello there' });
    expect(res.status).toBe(200);
    expect(sendSmsMock).toHaveBeenCalledWith('+18015550001', 'hello there');
    expect(h.db.writes.map(w => [w.table, w.op])).toEqual([['lead_messages', 'insert'], ['client_leads', 'update']]);
    expect(h.db.writes[1].filters).toEqual([['id', 'lead-a'], ['session_id', TENANT_A]]);
  });

  it('refuses a live opted-out lead with 409 and does not send or take over', async () => {
    h.db.tables.jc_sms_conversations = [{ from_number: '+18015550001', opted_out: true }];
    const res = await call('lead-a', { session_id: TENANT_A, text: 'hello there' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/asked not to be contacted/i);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(h.db.writes).toEqual([]);
  });

  it('fails closed when the live opt-out read errors', async () => {
    const originalFrom = h.db.client.from;
    h.db.client = {
      from: (table: string) => table === 'jc_sms_conversations'
        ? { select: () => ({ eq: () => ({ range: async () => ({ data: null, error: { message: 'read failed' } }) }) }) }
        : originalFrom(table),
    };
    const res = await call('lead-a', { session_id: TENANT_A, text: 'hello there' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/couldn't be checked/i);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('records a marked fake send for a practice tenant without calling Telnyx', async () => {
    h.user = USERS.practice;
    const res = await call('lead-practice', { session_id: PRACTICE, text: 'Hello from the office' });
    expect(res.status).toBe(200);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(h.db.writes.find(w => w.table === 'lead_messages')?.values).toMatchObject({
      body: '[Practice fake sent to lead] Hello from the office',
      direction: 'outbound',
      author: 'human',
    });
  });

  it('refuses a practice fake-opted-out lead without calling Telnyx', async () => {
    h.user = USERS.practice;
    h.db.tables.lead_messages = [{
      lead_id: 'lead-practice', session_id: PRACTICE, channel: 'call_note', author: 'human',
      body: '[Practice fake] Do not contact phone=+18015550004', created_at: '2026-10-09T12:00:00.000Z',
    }];
    const res = await call('lead-practice', { session_id: PRACTICE, text: 'Hello from the office' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/asked not to be contacted/i);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(h.db.writes).toEqual([]);
  });

  it('allows an internal (portal_access mate) user', async () => {
    h.user = USERS.internal;
    expect((await call('lead-a', { text: 'hi' })).status).toBe(200);
  });

  it('404s an unknown lead', async () => {
    expect((await call('ghost', { text: 'hi' })).status).toBe(404);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('404s a lead with no phone', async () => {
    h.db.tables.client_leads[0].phone = null;
    expect((await call('lead-a', { text: 'hi' })).status).toBe(404);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('does NOT take over or log when the SMS send fails', async () => {
    sendSmsMock.mockResolvedValueOnce({ ok: false, error: 'boom' });
    const res = await call('lead-a', { text: 'hello there' });
    expect(res.status).toBe(502);
    expect(h.db.writes).toEqual([]);
  });

  describe('phone is read only after authorization', () => {
    const phoneReads = () => h.db.reads.filter(r => r.table === 'client_leads' && r.columns.includes('phone'));

    it('anonymous: the gate reads tenant identity only, never the phone', async () => {
      h.user = null;
      expect((await call('lead-a', { text: 'hi' })).status).toBe(401);
      expect(h.db.reads.filter(r => r.table === 'client_leads')).toEqual([
        { table: 'client_leads', columns: 'id, session_id', filters: [['id', 'lead-a']] },
      ]);
      expect(phoneReads()).toEqual([]);
    });

    it('cross-tenant: no phone read', async () => {
      h.user = USERS.memberB;
      expect((await call('lead-a', { text: 'hi' })).status).toBe(403);
      expect(phoneReads()).toEqual([]);
    });

    it('demo / unmapped tenant: refused before the phone is read', async () => {
      h.user = null;
      expect((await call('lead-demo', { text: 'hi' })).status).toBe(403);
      h.user = USERS.memberB;
      expect((await call('lead-b', { text: 'hi' })).status).toBe(403);
      expect(phoneReads()).toEqual([]);
    });

    it('member: phone read happens after the membership check, scoped to the lead tenant', async () => {
      expect((await call('lead-a', { text: 'hi' })).status).toBe(200);
      const memberIdx = h.db.reads.findIndex(r => r.table === 'portal_members');
      const phoneIdx = h.db.reads.findIndex(r => r.table === 'client_leads' && r.columns.includes('phone'));
      expect(memberIdx).toBeGreaterThanOrEqual(0);
      expect(phoneIdx).toBeGreaterThan(memberIdx);
      expect(h.db.reads[phoneIdx].filters).toEqual([['id', 'lead-a'], ['session_id', TENANT_A]]);
    });
  });
});
