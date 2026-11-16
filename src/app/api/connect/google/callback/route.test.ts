import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

const { practiceStatus, fetchMock, syncSessionCalendar, gate, auth, counter } = vi.hoisted(() => ({
  practiceStatus: vi.fn(),
  gate: vi.fn(),
  auth: { user: { id: 'user-own' } as { id: string } | null, throws: false },
  // demo_counter_bump in memory: (scope, key) -> n, allowed while n < cap.
  counter: { rows: new Map<string, number>(), error: false },
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
  createServiceClient: () => ({
    from: (table: string) => tableStub(table),
    rpc: async (_fn: string, a: { p_scope: string; p_key: string; p_cap: number }) => {
      if (counter.error) return { data: null, error: { message: 'counter down' } };
      const k = `${a.p_scope}:${a.p_key}`;
      const n = counter.rows.get(k) ?? 0;
      if (n >= a.p_cap) return { data: false, error: null };
      counter.rows.set(k, n + 1);
      return { data: true, error: null };
    },
  }),
};
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/portal/practice', () => ({ practiceStatus }));
vi.mock('@/lib/portal/onboarding-gate', () => ({ checkOnboardingAccess: (_req: Request, id: string) => gate(id) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        if (auth.throws) throw new Error('auth service unreachable');
        return { data: { user: auth.user } };
      },
    },
  }),
}));
vi.mock('@/lib/metrics/calendarSyncRun', () => ({ syncSessionCalendar }));
vi.stubGlobal('fetch', fetchMock);

import { GET } from './route';
import { GOOGLE_STATE_COOKIE, signGoogleState } from '@/lib/portal/google-oauth-state';

const SECRET = 'google-state-test-secret';
const NONCE = 'nonce-from-the-start-leg';

/** A callback as Google sends it back, with a state signed the way the start leg signs it. */
function callback(
  sessionId: string,
  o: { userId?: string; exp?: number; cookie?: string | null; secret?: string; rawState?: string } = {},
) {
  const state = o.rawState ?? signGoogleState(
    { sessionId, nonce: NONCE, userId: o.userId ?? 'user-own', exp: o.exp ?? Date.now() + 60_000 },
    o.secret ?? SECRET,
  );
  const cookie = o.cookie === undefined ? NONCE : o.cookie;
  return new NextRequest(`http://mate.test/api/connect/google/callback?state=${encodeURIComponent(state)}&code=fake-code`, {
    headers: cookie === null ? {} : { cookie: `${GOOGLE_STATE_COOKIE}=${cookie}` },
  });
}
const request = (sessionId: string) => callback(sessionId);

beforeEach(() => {
  practiceStatus.mockReset();
  gate.mockReset();
  gate.mockResolvedValue({ ok: true, access: 'creator' });
  auth.user = { id: 'user-own' };
  auth.throws = false;
  counter.rows.clear();
  counter.error = false;
  process.env.GOOGLE_OAUTH_STATE_SECRET = SECRET;
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

  // `state` is only a session id. A caller who may not open that session must
  // never get a Google token stored on it (or its calendar synced into it).
  it("never exchanges a code for another tenant's session", async () => {
    gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const response = await GET(request('other-session'));

    expect(gate).toHaveBeenCalledWith('other-session');
    expect(response.headers.get('location')).toContain('/onboard?google=forbidden');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncSessionCalendar).not.toHaveBeenCalled();
  });

  it('never exchanges a code for the public demo session', async () => {
    gate.mockResolvedValue({ ok: true, access: 'demo' });
    const response = await GET(request('demo-session'));
    expect(response.headers.get('location')).toContain('google=forbidden');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('signed state, before any read or code exchange', () => {
    beforeEach(() => practiceStatus.mockResolvedValue({ ok: true, isPractice: false }));

    function expectRefused(response: Response, status = 'forbidden') {
      expect(response.headers.get('location')).toContain(`google=${status}`);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(gate).not.toHaveBeenCalled();
      expect(practiceStatus).not.toHaveBeenCalled();
      expect(syncSessionCalendar).not.toHaveBeenCalled();
    }

    it('refuses a forged state: the bare session id, a wrong key, or a tampered payload', async () => {
      expectRefused(await GET(callback('normal-session', { rawState: 'normal-session' })));
      expectRefused(await GET(callback('normal-session', { secret: 'attacker-key' })));
      const good = signGoogleState({ sessionId: 'normal-session', nonce: NONCE, userId: 'user-own', exp: Date.now() + 60_000 }, SECRET);
      const [, sig] = good.split('.');
      const swapped = Buffer.from(JSON.stringify({ s: 'other-session', n: NONCE, u: 'user-own', e: Date.now() + 60_000 })).toString('base64url');
      expectRefused(await GET(callback('normal-session', { rawState: `${swapped}.${sig}` })));
    });

    it('refuses when the nonce cookie is missing or does not match', async () => {
      expectRefused(await GET(callback('normal-session', { cookie: null })));
      expectRefused(await GET(callback('normal-session', { cookie: 'some-other-nonce' })));
    });

    it('refuses an expired state', async () => {
      expectRefused(await GET(callback('normal-session', { exp: Date.now() - 1 })), 'expired');
    });

    it('refuses when another user (or nobody) is signed in', async () => {
      expectRefused(await GET(callback('normal-session', { userId: 'user-attacker' })));
      auth.user = null;
      expectRefused(await GET(callback('normal-session')));
    });

    it('a valid flow exchanges the code for the session in the state, and clears the nonce', async () => {
      const response = await GET(callback('normal-session'));
      expect(response.headers.get('location')).toContain('google=connected');
      expect(gate).toHaveBeenCalledWith('normal-session');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(syncSessionCalendar).toHaveBeenCalledWith('normal-session', expect.any(String));
      expect(response.cookies.get(GOOGLE_STATE_COOKIE)).toMatchObject({ value: '', maxAge: 0 });
    });

    it('clears the nonce on a refusal too', async () => {
      const response = await GET(callback('normal-session', { cookie: 'some-other-nonce' }));
      expect(response.cookies.get(GOOGLE_STATE_COOKIE)).toMatchObject({ value: '', maxAge: 0 });
    });
  });

  describe('single use, on every outcome', () => {
    beforeEach(() => practiceStatus.mockResolvedValue({ ok: true, isPractice: false }));
    const cleared = (r: NextResponse) =>
      expect(r.cookies.get(GOOGLE_STATE_COOKIE)).toMatchObject({ value: '', maxAge: 0 });

    it('refuses a replay of the same callback, even with the cookie still present', async () => {
      const first = await GET(callback('normal-session'));
      expect(first.headers.get('location')).toContain('google=connected');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const replay = await GET(callback('normal-session'));
      expect(replay.headers.get('location')).toContain('google=forbidden');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(syncSessionCalendar).toHaveBeenCalledTimes(1);
      cleared(replay);
    });

    it('refuses when the single-use record cannot be written (fails closed)', async () => {
      counter.error = true;
      const res = await GET(callback('normal-session'));
      expect(res.headers.get('location')).toContain('google=forbidden');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still answers and clears the cookie when something throws inside the callback', async () => {
      auth.throws = true;
      const res = await GET(callback('normal-session'));
      expect(res.headers.get('location')).toContain('google=error');
      expect(fetchMock).not.toHaveBeenCalled();
      cleared(res);

      auth.throws = false;
      gate.mockRejectedValue(new Error('membership lookup failed'));
      const res2 = await GET(callback('normal-session', { cookie: NONCE }));
      expect(res2.headers.get('location')).toContain('google=error');
      expect(fetchMock).not.toHaveBeenCalled();
      cleared(res2);
    });
  });
});
