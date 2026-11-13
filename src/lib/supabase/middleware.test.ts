// @vitest-environment node
// The proxy's redirects (signed-out gate in updateSession, the dedicated root
// redirect in tenantRoute) go to the pinned public origin, never to an origin
// built from Host / X-Forwarded-Host or next start's own listen address. The
// ?next= the gate writes is checked like the one the login page reads
// (src/lib/portal/safe-next.ts).
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { updateSession } from './middleware';
import { tenantRoute } from './tenant-proxy';

const PINNED = 'https://mate.auto-mate.business';
const FORGED = {
  host: 'evil.example',
  'x-forwarded-host': 'evil.example',
  'x-forwarded-proto': 'http',
  'x-forwarded-port': '8443',
};
// What next start behind Traefik hands the proxy: its own listen address in the URL.
const req = (path: string, headers: Record<string, string> = FORGED) =>
  // Concatenated, not new URL(path, base): a path of "//evil.example" must stay a path.
  new NextRequest(`https://localhost:3000${path}`, { headers });

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL', undefined);
  vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://control-project.supabase.co');
});
afterEach(() => vi.unstubAllEnvs());

describe('updateSession: signed-out redirect to /login', () => {
  it.each([
    ['no forged headers', {}],
    ['a forged Host', { host: 'evil.example' }],
    ['a forged X-Forwarded-Host', { host: 'mate.auto-mate.business', 'x-forwarded-host': 'evil.example' }],
    ['forged Host, X-Forwarded-Host, -Proto and -Port', FORGED],
  ])('with %s: the full Location is on the pinned origin', async (_, headers) => {
    const response = await updateSession(req('/codes?tab=new', headers));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${PINNED}/login?next=%2Fcodes%3Ftab%3Dnew`);
  });

  it.each([
    ['a protocol-relative path', '//evil.example/x'],
    ['an encoded protocol-relative path', '/%2F%2Fevil.example'],
    ['an encoded backslash', '/%5Cevil.example'],
    ['a nested next in the query', '/codes?next=https://evil.example'],
    ['a nested return-to in the query', '/codes?return-to=//evil.example'],
  ])('drops next for %s, still on the pinned origin', async (_, path) => {
    const response = await updateSession(req(path));
    expect(response.headers.get('location')).toBe(`${PINNED}/login`);
  });

  it('the protocol-relative request really reaches the gate as a path', () => {
    expect(req('//evil.example/x').nextUrl.pathname).toBe('//evil.example/x');
  });

  it('fails closed off Vercel with no NEXT_PUBLIC_MATE_URL: a 500 and no Location', async () => {
    vi.stubEnv('NEXT_PUBLIC_MATE_URL', undefined);
    const response = await updateSession(req('/codes'));
    expect(response.status).toBe(500);
    expect(response.headers.get('location')).toBeNull();
  });

  it('public paths are not redirected', async () => {
    for (const p of ['/login', '/demo', '/dash/abc', '/api/leads/ingest']) {
      expect((await updateSession(req(p))).headers.get('location'), p).toBeNull();
    }
  });
});

describe('tenantRoute (dedicated deployment): the bare root', () => {
  it('goes to /postlogin on the pinned origin, whatever Host / X-Forwarded-Host say', () => {
    vi.stubEnv('SUPABASE_DATA_URL', 'https://client-data-project.supabase.co');
    vi.stubEnv('SUPABASE_DATA_SECRET_KEY', 'fake-data-project-key');
    vi.stubEnv('MATE_DATA_SESSION_IDS', '11111111-1111-4111-8111-111111111111');
    const response = tenantRoute(req('/'));
    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toBe(`${PINNED}/postlogin`);
  });
});
