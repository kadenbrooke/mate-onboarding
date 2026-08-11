import { describe, it, expect, vi, beforeEach } from 'vitest';

const single = vi.fn();
const maybeSingle = vi.fn();
// Captures every insert payload as [table, values] so a test can assert what
// the fire action recorded (created_by_fire in particular).
const inserts: [string, unknown][] = [];
// Captures deletes as [table, eqArgs] so the ignore path is observable.
const deletes: [string, unknown[][]][] = [];
let deleteError: { message: string } | null = null;

function tableStub(table: string) {
  return {
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle, single, order: () => ({ limit: () => ({ maybeSingle }) }) }), maybeSingle, single }) }),
    insert: (v: unknown) => {
      inserts.push([table, v]);
      return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-lead', session_id: 's1', phone: '+18015551234' }, error: null }) }) };
    },
    update: (v: unknown) => { void v; return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }; },
    delete: () => {
      const args: unknown[][] = [];
      deletes.push([table, args]);
      const chain = {
        eq: (...a: unknown[]) => { args.push(a); return args.length === 1 ? chain : Promise.resolve({ error: deleteError }); },
      };
      return chain;
    },
  };
}
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: (t: string) => tableStub(t) }) }));
vi.mock('@/lib/agent/telnyx', () => ({ sendSms: vi.fn(async () => ({ ok: true })) }));
// The note extractor is a live LLM call; the route contract is only that it
// runs and never throws, so it is stubbed everywhere here.
const applyNoteToLead = vi.fn(async () => ({ patched: [] as string[] }));
vi.mock('@/lib/agent/noteExtract', () => ({ applyNoteToLead: (...a: unknown[]) => applyNoteToLead(...(a as [])) }));

import { POST } from './route';
import { sendSms } from '@/lib/agent/telnyx';

beforeEach(() => {
  process.env.AGENT_WEBHOOK_TOKEN = 'tok';
  single.mockReset();
  maybeSingle.mockReset();
  inserts.length = 0;
  deletes.length = 0;
  deleteError = null;
  applyNoteToLead.mockClear();
});

const url = (qs: string) => `http://x/api/agent/postcall?${qs}`;
const post = (qs: string, body: unknown) => POST(new Request(url(qs), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);

describe('POST /api/agent/postcall', () => {
  it('401s without the token', async () => {
    expect((await post('action=fire', { session_id: 's1', caller: '+1' })).status).toBe(401);
  });
  it('fire sends the menu to the operator', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'l1', session_id: 's1', phone: '+18015551234' }, error: null });
    single.mockResolvedValueOnce({ data: { operator_phone: '+18019414398', onboarding_form_url: null, faq_url: null }, error: null });
    const res = await post('action=fire&k=tok', { session_id: 's1', caller: '+18015551234' });
    expect(res.status).toBe(200);
    expect(sendSms).toHaveBeenCalledWith('+18019414398', expect.stringContaining('What next?'));
  });

  it('routes a quote-menu reply (choice 1) through the quote path', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'pc1', lead_id: null, kind: 'quote', jc_conversation_id: 'conv1' }, error: null });
    const res = await post('action=operator_reply&k=tok', { session_id: 's1', text: '1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, kind: 'quote' });
  });

  it('logs notes on a quote-menu reply with notes (choice 2)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'pc1', lead_id: null, kind: 'quote', jc_conversation_id: 'conv1' }, error: null });
    single.mockResolvedValueOnce({ data: { notes: null }, error: null });
    const res = await post('action=operator_reply&k=tok', { session_id: 's1', text: '2 wants to think about the price' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'quote' });
  });

  it('fire records created_by_fire=false when the caller is already a lead', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'l1', session_id: 's1', phone: '+18015551234' }, error: null });
    single.mockResolvedValueOnce({ data: { operator_phone: '+18019414398', onboarding_form_url: null, faq_url: null }, error: null });
    await post('action=fire&k=tok', { session_id: 's1', caller: '+18015551234' });
    const pc = inserts.find(([t]) => t === 'lead_postcall');
    expect(pc?.[1]).toMatchObject({ created_by_fire: false });
  });

  it('fire records created_by_fire=true when it had to create the lead', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null }); // no existing lead
    single.mockResolvedValueOnce({ data: { operator_phone: '+18019414398', onboarding_form_url: null, faq_url: null }, error: null });
    await post('action=fire&k=tok', { session_id: 's1', caller: '+18015551234' });
    const pc = inserts.find(([t]) => t === 'lead_postcall');
    expect(pc?.[1]).toMatchObject({ created_by_fire: true });
  });
});

describe('POST /api/agent/postcall - Ignore (choice 4) on the call menu', () => {
  it('deletes a lead this call created, scoped to id + session', async () => {
    // open menu, created by this fire
    maybeSingle.mockResolvedValueOnce({ data: { id: 'pc1', lead_id: 'l1', kind: 'call', jc_conversation_id: null, created_by_fire: true }, error: null });
    // the lead row
    single.mockResolvedValueOnce({ data: { id: 'l1', session_id: 's1', phone: '+18015551234' }, error: null });
    // session config
    single.mockResolvedValueOnce({ data: { onboarding_form_url: null, faq_url: null }, error: null });

    const res = await post('action=operator_reply&k=tok', { session_id: 's1', text: '4' });
    expect(await res.json()).toMatchObject({ ok: true, deleted_lead: true });
    const del = deletes.find(([t]) => t === 'client_leads');
    expect(del?.[1]).toEqual([['id', 'l1'], ['session_id', 's1']]);
  });

  it('never deletes a lead that existed before the call', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'pc1', lead_id: 'l1', kind: 'call', jc_conversation_id: null, created_by_fire: false }, error: null });
    single.mockResolvedValueOnce({ data: { id: 'l1', session_id: 's1', phone: '+18015551234' }, error: null });
    single.mockResolvedValueOnce({ data: { onboarding_form_url: null, faq_url: null }, error: null });

    const res = await post('action=operator_reply&k=tok', { session_id: 's1', text: '4' });
    expect(await res.json()).not.toMatchObject({ deleted_lead: true });
    expect(deletes.find(([t]) => t === 'client_leads')).toBeUndefined();
  });

  it('falls back to the normal path when the delete fails', async () => {
    deleteError = { message: 'boom' };
    maybeSingle.mockResolvedValueOnce({ data: { id: 'pc1', lead_id: 'l1', kind: 'call', jc_conversation_id: null, created_by_fire: true }, error: null });
    single.mockResolvedValueOnce({ data: { id: 'l1', session_id: 's1', phone: '+18015551234' }, error: null });
    single.mockResolvedValueOnce({ data: { onboarding_form_url: null, faq_url: null }, error: null });

    const res = await post('action=operator_reply&k=tok', { session_id: 's1', text: '4 he is a supplier' });
    expect(res.status).toBe(200);
    expect(await res.json()).not.toMatchObject({ deleted_lead: true });
  });
});

describe('POST /api/agent/postcall - call-note extraction', () => {
  it('runs the extractor on freeform notes', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'pc1', lead_id: 'l1', kind: 'call', jc_conversation_id: null, created_by_fire: false }, error: null });
    single.mockResolvedValueOnce({ data: { id: 'l1', session_id: 's1', phone: '+18015551234' }, error: null });
    single.mockResolvedValueOnce({ data: { onboarding_form_url: null, faq_url: null }, error: null });

    await post('action=operator_reply&k=tok', { session_id: 's1', text: 'talked to Dave, 1450 e center st in Lehi' });
    expect(applyNoteToLead).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ leadId: 'l1', sessionId: 's1', note: 'talked to Dave, 1450 e center st in Lehi' }),
    );
  });

  it('does not run the extractor when there are no notes', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'pc1', lead_id: 'l1', kind: 'call', jc_conversation_id: null, created_by_fire: false }, error: null });
    single.mockResolvedValueOnce({ data: { id: 'l1', session_id: 's1', phone: '+18015551234' }, error: null });
    single.mockResolvedValueOnce({ data: { onboarding_form_url: null, faq_url: null }, error: null });

    await post('action=operator_reply&k=tok', { session_id: 's1', text: '2' });
    expect(applyNoteToLead).not.toHaveBeenCalled();
  });
});
