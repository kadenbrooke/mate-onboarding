import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { practiceStatus, gate, auth } = vi.hoisted(() => ({
  practiceStatus: vi.fn(),
  gate: vi.fn(),
  auth: { user: { id: 'user-own' } as { id: string } | null },
}));

vi.mock('@/lib/supabase/service', () => {
  const m = { createServiceClient: () => ({}) };
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/portal/practice', () => ({ practiceStatus }));
vi.mock('@/lib/portal/onboarding-gate', () => ({ checkOnboardingAccess: (_req: Request, id: string) => gate(id) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }) } }),
}));

import { GET } from './route';
import { GOOGLE_STATE_COOKIE, GOOGLE_STATE_TTL_MS, verifyGoogleState } from '@/lib/portal/google-oauth-state';

beforeEach(() => {
  practiceStatus.mockReset();
  gate.mockReset();
  gate.mockResolvedValue({ ok: true, access: 'member' });
  auth.user = { id: 'user-own' };
  process.env.GOOGLE_OAUTH_STATE_SECRET = 'google-state-test-secret';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'fake-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'fake-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://mate.example.test/google/callback';
});

describe('GET /api/connect/google', () => {
  it('refuses to start Google OAuth for a practice tenant', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: true });
    const response = await GET(new NextRequest('http://mate.test/api/connect/google?sessionId=practice-session'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/dash/practice-session?google=practice');
  });

  it('starts Google OAuth for a normal tenant with a signed state and a nonce cookie', async () => {
    practiceStatus.mockResolvedValue({ ok: true, isPractice: false });
    const before = Date.now();
    const response = await GET(new NextRequest('http://mate.test/api/connect/google?sessionId=normal-session'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');

    // state is not the bare session id: it is signed and binds session, user, nonce and expiry.
    const raw = location.searchParams.get('state');
    expect(raw).not.toBe('normal-session');
    const state = verifyGoogleState(raw, 'google-state-test-secret');
    expect(state).toMatchObject({ sessionId: 'normal-session', userId: 'user-own' });
    expect(state!.exp).toBeGreaterThanOrEqual(before + GOOGLE_STATE_TTL_MS);
    expect(state!.exp).toBeLessThanOrEqual(Date.now() + GOOGLE_STATE_TTL_MS);

    const cookie = response.cookies.get(GOOGLE_STATE_COOKIE);
    expect(cookie?.value).toBe(state!.nonce);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/api/connect/google' });
  });

  it('needs a session and a signed-in user', async () => {
    expect((await GET(new NextRequest('http://mate.test/api/connect/google'))).status).toBe(400);

    practiceStatus.mockResolvedValue({ ok: true, isPractice: false });
    auth.user = null;
    const response = await GET(new NextRequest('http://mate.test/api/connect/google?sessionId=normal-session'));
    expect(response.headers.get('location')).toContain('google=forbidden');
    expect(response.cookies.get(GOOGLE_STATE_COOKIE)).toBeUndefined();
  });

  // The callback stores a refresh token on the session in `state`, so only a
  // caller allowed to open THAT session may start the flow for it.
  it("refuses to start Google OAuth for another tenant's session", async () => {
    gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const response = await GET(new NextRequest('http://mate.test/api/connect/google?sessionId=other-session'));

    expect(gate).toHaveBeenCalledWith('other-session');
    expect(response.headers.get('location')).toContain('/dash/other-session?google=forbidden');
    expect(response.headers.get('location')).not.toContain('accounts.google.com');
    expect(practiceStatus).not.toHaveBeenCalled();
  });

  it('refuses to start Google OAuth for the public demo session', async () => {
    gate.mockResolvedValue({ ok: true, access: 'demo' });
    const response = await GET(new NextRequest('http://mate.test/api/connect/google?sessionId=demo-session'));
    expect(response.headers.get('location')).toContain('google=forbidden');
  });
});
