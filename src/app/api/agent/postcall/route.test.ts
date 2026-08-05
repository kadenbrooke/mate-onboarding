import { describe, it, expect, vi, beforeEach } from 'vitest';

const single = vi.fn();
const maybeSingle = vi.fn();
function tableStub() {
  return {
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle, single, order: () => ({ limit: () => ({ maybeSingle }) }) }), maybeSingle, single }) }),
    insert: (v: unknown) => { void v; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-lead', session_id: 's1', phone: '+18015551234' }, error: null }) }) }; },
    update: (v: unknown) => { void v; return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }; },
  };
}
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: () => tableStub() }) }));
vi.mock('@/lib/agent/telnyx', () => ({ sendSms: vi.fn(async () => ({ ok: true })) }));

import { POST } from './route';
import { sendSms } from '@/lib/agent/telnyx';

beforeEach(() => { process.env.AGENT_WEBHOOK_TOKEN = 'tok'; single.mockReset(); maybeSingle.mockReset(); });

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
});
