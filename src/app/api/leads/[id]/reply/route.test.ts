import { describe, it, expect, vi, beforeEach } from 'vitest';

const single = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === 'client_leads') {
    return { select: () => ({ eq: () => ({ eq: () => ({ single }) }) }), update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };
  }
  if (table === 'lead_messages') return { insert: () => Promise.resolve({ error: null }) };
  return {};
});
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: fromMock }) }));
vi.mock('@/lib/agent/telnyx', () => ({ sendSms: vi.fn(async () => ({ ok: true })) }));

import { POST } from './route';
import { sendSms } from '@/lib/agent/telnyx';

const req = (body: unknown) => new Request('http://x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const params = Promise.resolve({ id: 'lead-1' });

beforeEach(() => { single.mockResolvedValue({ data: { phone: '+18015551234' }, error: null }); });

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
});
