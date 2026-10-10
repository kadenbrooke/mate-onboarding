import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeDb, PRACTICE, seedTenants, TENANT_A, TENANT_B, USERS, type FakeDb,
} from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ ...h.db.client, rpc: h.rpc }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));

import { POST } from './route';

const req = (body: unknown) => new Request('http://x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const call = (leadId: string, body: unknown) => POST(req(body) as never, { params: Promise.resolve({ id: leadId }) });

beforeEach(() => {
  h.db = createFakeDb(seedTenants());
  h.user = USERS.memberA;
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [{ event_id: 'event-1', normalized_phone: '+18015550001' }], error: null });
});

describe('POST /api/leads/[id]/do-not-contact', () => {
  it('401s an unauthenticated caller before any RPC or write', async () => {
    h.user = null;
    const res = await call('lead-a', { session_id: TENANT_A });
    expect(res.status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.db.writes).toEqual([]);
  });

  it('denies a member of another tenant before reading the lead phone', async () => {
    h.user = USERS.memberB;
    const res = await call('lead-a', { session_id: TENANT_A });
    expect(res.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.db.reads.some(r => r.table === 'client_leads' && r.columns.includes('phone'))).toBe(false);
  });

  it('refuses demo access even though the demo dashboard is public', async () => {
    h.user = null;
    const res = await call('lead-demo', {});
    expect(res.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.db.writes).toEqual([]);
  });

  it('records a marked fake practice result without calling the RPC', async () => {
    h.user = USERS.practice;
    const res = await call('lead-practice', { session_id: PRACTICE });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, practice: true, fake: true });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.db.writes).toContainEqual(expect.objectContaining({
      table: 'lead_messages', op: 'insert',
      values: expect.objectContaining({ author: 'human', channel: 'call_note', body: expect.stringContaining('[Practice fake]') }),
    }));
  });

  it('refuses an unmapped non-practice tenant without reading its phone', async () => {
    h.user = USERS.memberB;
    const res = await call('lead-b', { session_id: TENANT_B });
    expect(res.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.db.reads.some(r => r.table === 'client_leads' && r.columns.includes('phone'))).toBe(false);
  });

  it('surfaces a missing RPC and marks nothing', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'function is missing' } });
    const res = await call('lead-a', { session_id: TENANT_A });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/opt-out could not be recorded/i);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.db.writes).toEqual([]);
  });

  it('calls the RPC once with the lane-normalized phone and signed-in email, then logs a human call note', async () => {
    h.db.tables.client_leads[0].phone = '(801) 555-0001';
    const res = await call('lead-a', { session_id: TENANT_A });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, normalized_phone: '+18015550001', recorded_by: USERS.memberA.email });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('jc_record_spoken_optout', {
      phone: '+18015550001', recorded_by: USERS.memberA.email,
    });
    expect(h.db.writes).toContainEqual(expect.objectContaining({
      table: 'lead_messages', op: 'insert',
      values: expect.objectContaining({ author: 'human', channel: 'call_note', direction: 'inbound' }),
    }));
  });
});
