import { describe, it, expect, vi, beforeEach } from 'vitest';

const single = vi.fn();
const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
const updateSpy = vi.fn(() => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }));
const fromMock = vi.fn((table: string) => {
  if (table === 'client_leads') {
    return { select: () => ({ eq: () => ({ eq: () => ({ single }) }) }), update: updateSpy };
  }
  if (table === 'lead_messages') return { insert: insertSpy };
  return {};
});
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: fromMock }) }));
const sendSmsMock = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
vi.mock('@/lib/agent/telnyx', () => ({ sendSms: (...args: unknown[]) => sendSmsMock(...(args as [])) }));

import { POST } from './route';
const sendSms = sendSmsMock;

const req = (body: unknown) => new Request('http://x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const params = Promise.resolve({ id: 'lead-1' });

beforeEach(() => {
  single.mockResolvedValue({ data: { phone: '+18015551234' }, error: null });
  insertSpy.mockClear();
  updateSpy.mockClear();
  sendSmsMock.mockReset();
  sendSmsMock.mockResolvedValue({ ok: true });
});

describe('POST /api/leads/[id]/reply', () => {
  it('rejects missing session_id or body with 400', async () => {
    expect((await POST(req({ text: 'hi' }) as never, { params })).status).toBe(400);
    expect((await POST(req({ session_id: 's1' }) as never, { params })).status).toBe(400);
  });
  it('sends the SMS and returns ok', async () => {
    const res = await POST(req({ session_id: 's1', text: 'hello there' }) as never, { params });
    expect(res.status).toBe(200);
    expect(sendSms).toHaveBeenCalledWith('+18015551234', 'hello there');
  });
  it('404s when the lead has no phone / not found', async () => {
    single.mockResolvedValue({ data: null, error: null });
    expect((await POST(req({ session_id: 's1', text: 'hi' }) as never, { params })).status).toBe(404);
  });
  it('does NOT take over or log when the SMS send fails', async () => {
    sendSmsMock.mockResolvedValueOnce({ ok: false, error: 'boom' });
    const res = await POST(req({ session_id: 's1', text: 'hello there' }) as never, { params });
    expect(res.status).toBe(502);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
