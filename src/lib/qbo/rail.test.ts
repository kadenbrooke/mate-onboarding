import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, sessionPractice } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  sessionPractice: { value: true },
}));

vi.mock('@/lib/supabase/service', () => {
  const m = {
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { is_practice: sessionPractice.value }, error: null }) }),
      }),
    }),
  }),
};
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.stubGlobal('fetch', fetchMock);

import { requestTokenExchange } from './rail';

beforeEach(() => {
  sessionPractice.value = true;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) });
  process.env.QBO_RAIL_EXCHANGE_URL = 'https://n8n.example.test/qbo-exchange';
  process.env.QBO_PROXY_SECRET = 'fake-secret';
});

describe('requestTokenExchange', () => {
  it('does not call the QBO rail for a practice tenant', async () => {
    const result = await requestTokenExchange({
      sessionId: 'practice-session', realmId: 'fake-realm', code: 'fake-code', environment: 'sandbox',
    });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Practice') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the QBO rail for a normal tenant', async () => {
    sessionPractice.value = false;
    const result = await requestTokenExchange({
      sessionId: 'normal-session', realmId: 'fake-realm', code: 'fake-code', environment: 'sandbox',
    });

    expect(result).toEqual({ ok: true, realmId: 'fake-realm' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
