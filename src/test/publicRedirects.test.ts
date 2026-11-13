// @vitest-environment node
// Every route that used to build a redirect (or a link) from request.url /
// nextUrl.origin now uses the pinned public origin (src/lib/public-url.ts).
// Self-hosted `next start` hands routes its own listen address, and a client
// can forge Host / X-Forwarded-*, so each route is driven here with exactly
// that request and must answer only on NEXT_PUBLIC_MATE_URL.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  writesEnabled: true,
  verifiedState: { sessionId: 'sess-1', nonce: 'nonce' } as { sessionId: string; nonce: string } | null,
  exchangeError: null as unknown,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { signOut: async () => ({ error: null }) } }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: h.exchangeError }),
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
  }),
}));
vi.mock('@/lib/supabase/service', () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    insert: () => chain,
    maybeSingle: async () => ({ data: { id: 'sess-1', is_demo: false }, error: null }),
    single: async () => ({ data: { code: 'ABC23', referrer_name: 'Pat', expires_at: null }, error: null }),
  });
  const m = { createServiceClient: () => ({ from: () => chain }) };
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/supabase/write-gate', () => ({
  dataWritesEnabled: () => h.writesEnabled,
  refuseIfWritesDisabled: () => null,
}));
vi.mock('@/lib/supabase/tenancy', () => ({
  readTenancy: () => ({ mode: 'shared' }),
  routeSession: () => ({ served: true }),
}));
vi.mock('@/lib/supabase/tenant-response', () => ({ unservedSessionResponse: () => null }));
vi.mock('@/lib/portal/practice', () => ({ practiceStatus: async () => ({ ok: true, isPractice: true }) }));
vi.mock('@/lib/portal/dash-gate', () => ({ requireDashAccess: async () => 'member' }));
vi.mock('@/lib/portal/api-gate', () => ({ checkDashApiAccess: async () => ({ ok: true }) }));
vi.mock('@/lib/metrics/calendarSyncRun', () => ({ syncSessionCalendar: async () => ({ status: 'ok' }) }));
vi.mock('@/lib/qbo/config', () => ({ qboEnvironment: () => 'sandbox', qboOAuthConfig: () => ({}) }));
vi.mock('@/lib/qbo/state', () => ({
  verifyState: () => h.verifiedState,
  qbStateSecret: () => 'fake-state-key',
  signState: () => 'signed',
  newNonce: () => 'nonce',
  QB_STATE_COOKIE: 'qb_oauth_nonce',
}));
vi.mock('@/lib/qbo/rail', () => ({ requestTokenExchange: async () => ({ ok: true }) }));

import { GET as signout } from '@/app/auth/signout/route';
import { GET as authCallback } from '@/app/auth/callback/route';
import { GET as googleConnect } from '@/app/api/connect/google/route';
import { GET as googleCallback } from '@/app/api/connect/google/callback/route';
import { GET as qbConnect } from '@/app/api/qb/connect/route';
import { GET as qbCallback } from '@/app/api/qb/callback/route';
import { POST as createReferral } from '@/app/api/dash/[sessionId]/referrals/route';

const PINNED = 'https://mate.auto-mate.business';
// What `next start` behind Traefik receives from an attacker: its own listen
// address in request.url, and forged Host / X-Forwarded-* headers.
const FORGED = {
  host: 'evil.example',
  'x-forwarded-host': 'evil.example',
  'x-forwarded-proto': 'http',
  'x-forwarded-port': '8080',
};
const req = (path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(new URL(path, 'https://localhost:3000'), {
    method: init.method,
    body: init.body,
    headers: { ...FORGED, ...init.headers },
  });
const params = { params: Promise.resolve({ sessionId: 'sess-1' }) };

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL', undefined);
  vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'fake-client');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'fake-client-key');
  vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', `${PINNED}/api/connect/google/callback`);
  h.writesEnabled = true;
  h.verifiedState = { sessionId: 'sess-1', nonce: 'nonce' };
  h.exchangeError = null;
});
afterEach(() => vi.unstubAllEnvs());

describe('request-derived redirects answer only on NEXT_PUBLIC_MATE_URL', () => {
  it.each([
    ['sign-out', () => signout(req('/auth/signout?reason=retry')), 303, `${PINNED}/login?error=retry`],
    ['auth callback, signed in', () => authCallback(req('/auth/callback?code=c')), 307, `${PINNED}/postlogin`],
    ['auth callback, OAuth error', () => authCallback(req('/auth/callback?error=access_denied')), 307, `${PINNED}/login?error=oauth`],
    ['auth callback, no code', () => authCallback(req('/auth/callback')), 307, `${PINNED}/login?error=oauth`],
    ['Google connect, practice tenant', () => googleConnect(req('/api/connect/google?sessionId=sess-1')), 307, `${PINNED}/dash/sess-1?google=practice`],
    ['Google callback, declined', () => googleCallback(req('/api/connect/google/callback?state=sess-1&error=access_denied')), 307, `${PINNED}/onboard?google=denied`],
    ['QuickBooks connect, practice tenant', () => qbConnect(req('/api/qb/connect?sessionId=sess-1')), 307, `${PINNED}/dash/sess-1?qb=practice`],
    ['QuickBooks callback, practice tenant', () => qbCallback(req('/api/qb/callback?code=c&state=s&realmId=r', { headers: { cookie: 'qb_oauth_nonce=nonce' } })), 307, `${PINNED}/dash/sess-1?qb=practice`],
  ])('%s', async (_, run, status, expected) => {
    const response = await run();
    expect(response.status).toBe(status);
    expect(response.headers.get('location')).toBe(expected);
  });

  it('auth callback, failed code exchange', async () => {
    h.exchangeError = new Error('bad code');
    expect((await authCallback(req('/auth/callback?code=c'))).headers.get('location')).toBe(`${PINNED}/login?error=oauth`);
  });

  it('Google and QuickBooks connect while writes are shut', async () => {
    h.writesEnabled = false;
    expect((await googleConnect(req('/api/connect/google?sessionId=sess-1'))).headers.get('location')).toBe(`${PINNED}/dash/sess-1?google=writes_disabled`);
    expect((await qbConnect(req('/api/qb/connect?sessionId=sess-1'))).headers.get('location')).toBe(`${PINNED}/dash/sess-1?qb=writes_disabled`);
    expect((await googleCallback(req('/api/connect/google/callback?state=sess-1&code=c'))).headers.get('location')).toBe(`${PINNED}/onboard?google=writes_disabled`);
  });

  it('QuickBooks callback with a state that does not verify goes to login on the pinned origin', async () => {
    h.verifiedState = null;
    expect((await qbCallback(req('/api/qb/callback?code=c&state=forged'))).headers.get('location')).toBe(`${PINNED}/login?error=qb_state`);
  });

  it('a session id carrying a host cannot leave the pinned origin', async () => {
    h.writesEnabled = false;
    const response = await qbConnect(req('/api/qb/connect?sessionId=%2F%2Fevil.example'));
    expect(new URL(response.headers.get('location')!).origin).toBe(PINNED);
  });

  it('a new referral link is on the pinned origin', async () => {
    const response = await createReferral(req('/api/dash/sess-1/referrals', {
      method: 'POST',
      body: JSON.stringify({ referrer_name: 'Pat' }),
      headers: { 'content-type': 'application/json' },
    }), params);
    expect(response.status).toBe(201);
    expect((await response.json()).link).toBe(`${PINNED}/referral/ABC23`);
  });
});

describe('production off Vercel with no NEXT_PUBLIC_MATE_URL fails closed', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_MATE_URL', undefined));

  it.each([
    ['sign-out', () => signout(req('/auth/signout'))],
    ['auth callback', () => authCallback(req('/auth/callback?code=c'))],
    ['Google callback', () => googleCallback(req('/api/connect/google/callback?state=sess-1&error=x'))],
    ['QuickBooks callback', () => qbCallback(req('/api/qb/callback?code=c&state=forged'))],
  ])('%s: a 500 and no Location', async (_, run) => {
    const response = await run();
    expect(response.status).toBe(500);
    expect(response.headers.get('location')).toBeNull();
  });

  it('a referral link is refused before a code is written', async () => {
    const response = await createReferral(req('/api/dash/sess-1/referrals', {
      method: 'POST',
      body: JSON.stringify({ referrer_name: 'Pat' }),
      headers: { 'content-type': 'application/json' },
    }), params);
    expect(response.status).toBe(500);
  });
});
