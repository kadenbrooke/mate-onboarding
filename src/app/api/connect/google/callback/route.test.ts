import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { practiceStatus, fetchMock, syncSessionCalendar } = vi.hoisted(() => ({
  practiceStatus: vi.fn(),
  fetchMock: vi.fn(),
  syncSessionCalendar: vi.fn(async () => ({ status: 'ok', upserted: 0, removed: 0 })),
}));

function tableStub(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    upsert: () => Promise.resolve({ error: null }),
    maybeSingle: async () => ({ data: { collected: {}, contact_id: null }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  void table;
  return chain;
}

vi.mock('@/lib/supabase/service', () => {
  const m = {
  createServiceClient: () => ({ from: (table: string) => tableStub(table) }),
};
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/portal/practice', () => ({ practiceStatus }));
vi.mock('@/lib/metrics/calendarSyncRun', () => ({ syncSessionCalendar }));
vi.stubGlobal('fetch', fetchMock);

import { GET } from './route';

function request(sessionId: string) {
  return new NextRequest(`http://mate.test/api/connect/google/callback?state=${sessionId}&code=fake-code`);
}

beforeEach(() => {
  practiceStatus.mockReset();
  fetchMock.mockReset();
  syncSessionCalendar.mockClear();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'fake-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'fake-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://mate.example.test/google/callback';
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ refresh_token: 'fake-refresh-token' }) });
});

describe('GET /api/connect/google/callback', () => {
  it('does not exchange a Google code for a practice tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: true });
    const response = await GET(request('practice-session'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/onboard?google=practice');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges a Google code for a normal tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: false });
    const response = await GET(request('normal-session'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/onboard?google=connected');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
