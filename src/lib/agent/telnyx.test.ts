import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendSms } from './telnyx';

const origEnv = { ...process.env };
beforeEach(() => {
  process.env.TELNYX_API_KEY = 'key_test';
  process.env.MATE_TELNYX_NUMBER = '+13854409882';
});
afterEach(() => { process.env = { ...origEnv }; vi.restoreAllMocks(); });

describe('sendSms', () => {
  it('POSTs to Telnyx with from/to/text and bearer auth', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendSms('+18015551234', 'hello');
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telnyx.com/v2/messages');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer key_test' });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      from: '+13854409882', to: '+18015551234', text: 'hello',
    });
  });
  it('skips (ok:false, skipped:true) when env is unset', async () => {
    delete process.env.TELNYX_API_KEY;
    const res = await sendSms('+18015551234', 'hello');
    expect(res).toMatchObject({ ok: false, skipped: true });
  });
});
