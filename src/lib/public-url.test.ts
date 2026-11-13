// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicOrigin, publicRedirect, publicUrl } from './public-url';

const PINNED = 'https://mate.auto-mate.business';
// What self-hosted `next start` hands a route: its own listen address, whatever the client sent.
const req = (headers: Record<string, string> = {}, url = 'https://localhost:3000/auth/callback?code=x') =>
  new NextRequest(new URL(url), { headers });
const location = (headers: Record<string, string>) => publicRedirect('/postlogin', req(headers)).headers.get('location');

describe('publicRedirect / publicOrigin / publicUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  describe('production, NEXT_PUBLIC_MATE_URL pinned', () => {
    it("redirects to the pinned origin, not next start's own listen address", () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', `${PINNED}/`);
      expect(location({})).toBe(`${PINNED}/postlogin`);
    });

    it('ignores a malicious Host', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
      expect(location({ host: 'evil.example' })).toBe(`${PINNED}/postlogin`);
    });

    it('ignores a malicious X-Forwarded-Host', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
      expect(location({ host: 'mate.auto-mate.business', 'x-forwarded-host': 'evil.example' })).toBe(`${PINNED}/postlogin`);
    });

    it('ignores a spoofed X-Forwarded-Proto and X-Forwarded-Port', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
      expect(location({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.example', 'x-forwarded-port': '8080' })).toBe(`${PINNED}/postlogin`);
    });

    it('wins over VERCEL=1 too', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
      expect(publicOrigin(req({}, 'https://mate-onboarding-abc.vercel.app/x'))).toBe(PINNED);
    });

    it('keeps the status it is given (303 for sign-out)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
      const response = publicRedirect('/login?error=unauthorized', req(), 303);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${PINNED}/login?error=unauthorized`);
    });
  });

  describe('production fails closed off Vercel', () => {
    it.each([
      ['missing', undefined],
      ['blank', '  '],
      ['not https', 'http://mate.auto-mate.business'],
      ['not a URL', 'mate.auto-mate.business'],
    ])('NEXT_PUBLIC_MATE_URL %s: no origin, a 500 and no Location', (_, value) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VERCEL', undefined);
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', value);
      const r = req({ host: 'evil.example', 'x-forwarded-host': 'evil.example' });
      expect(publicOrigin(r)).toBeNull();
      expect(publicUrl('/referral/ABC', r)).toBeNull();
      const response = publicRedirect('/postlogin', r);
      expect(response.status).toBe(500);
      expect(response.headers.get('location')).toBeNull();
    });
  });

  describe('on Vercel without NEXT_PUBLIC_MATE_URL', () => {
    it("uses the deployment's own request.url, as before (previews sign in on their own URL)", () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', undefined);
      const r = req({ 'x-forwarded-host': 'evil.example' }, 'https://mate-onboarding-abc.vercel.app/auth/callback');
      expect(publicRedirect('/postlogin', r).headers.get('location')).toBe('https://mate-onboarding-abc.vercel.app/postlogin');
    });
  });

  describe('only same-site paths', () => {
    it('keeps a path with a query', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
      expect(publicRedirect('/dash/abc?qb=connected', req()).headers.get('location')).toBe(`${PINNED}/dash/abc?qb=connected`);
      expect(publicUrl('/referral/ABC23', req())?.toString()).toBe(`${PINNED}/referral/ABC23`);
    });

    it('a dot-segment stays on the pinned origin', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
      expect(publicRedirect('/dash/../login', req()).headers.get('location')).toBe(`${PINNED}/login`);
    });

    it.each([
      ['an absolute URL', 'https://evil.example/postlogin'],
      ['an absolute URL on the pinned host', `${PINNED}/postlogin`],
      ['a protocol-relative URL', '//evil.example/postlogin'],
      ['a backslash host', '/\\evil.example/postlogin'],
      ['a tab that the URL parser drops', '/\t/evil.example/postlogin'],
      ['a newline', '/postlogin\n'],
      ['no leading slash', 'postlogin'],
      ['a javascript: URL', 'javascript:alert(1)'],
      ['an empty path', ''],
    ])('refuses %s: a 500 and no Location', (_, path) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', PINNED);
      expect(publicUrl(path, req())).toBeNull();
      const response = publicRedirect(path, req());
      expect(response.status).toBe(500);
      expect(response.headers.get('location')).toBeNull();
    });
  });

  describe('development and tests', () => {
    it('without NEXT_PUBLIC_MATE_URL, uses request.url, never the headers', () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', undefined);
      expect(publicOrigin(req({ host: 'evil.example', 'x-forwarded-host': 'evil.example' }, 'http://localhost:3000/x'))).toBe('http://localhost:3000');
    });

    it('allows an http NEXT_PUBLIC_MATE_URL for local runs', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('NEXT_PUBLIC_MATE_URL', 'http://localhost:3100');
      expect(location({ host: 'evil.example' })).toBe('http://localhost:3100/postlogin');
    });
  });
});
