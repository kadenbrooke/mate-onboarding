// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signSession } from '@/lib/session-cookie';

const verdict = vi.fn();
vi.mock('./api-gate', () => ({ checkDashApiAccess: (id: string) => verdict(id) }));

import { checkOnboardingAccess, cookieSessionId } from './onboarding-gate';

const OWN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const SECRET = 'test-session-secret';
const OLD = { ...process.env };
const req = (cookie?: string) => new Request('http://x/api/mate', { headers: cookie ? { cookie } : {} });
const cookieFor = (id: string, secret = SECRET) => `other=1; mate_session=${encodeURIComponent(signSession(id, secret))}`;

beforeEach(() => {
  process.env.MATE_SESSION_SECRET = SECRET;
  verdict.mockReset();
});
afterEach(() => { process.env = { ...OLD }; });

describe('checkOnboardingAccess', () => {
  it('allows whatever the dash gate allows (demo, member, internal)', async () => {
    verdict.mockResolvedValue({ ok: true, access: 'member' });
    expect(await checkOnboardingAccess(req(), OWN)).toEqual({ ok: true, access: 'member' });
    expect(verdict).toHaveBeenCalledWith(OWN);
  });

  it("refuses a signed-in user on someone else's session", async () => {
    verdict.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    expect(await checkOnboardingAccess(req(), OTHER)).toEqual({ ok: false, status: 403, error: 'Not your dashboard.' });
  });

  it('refuses even with a valid cookie when the cookie is for a different session', async () => {
    verdict.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    expect((await checkOnboardingAccess(req(cookieFor(OWN)), OTHER)).ok).toBe(false);
  });

  it("allows the signed-in creator holding this session's signed cookie", async () => {
    verdict.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    expect(await checkOnboardingAccess(req(cookieFor(OWN)), OWN.toUpperCase())).toEqual({ ok: true, access: 'creator' });
  });

  it('never lets the cookie replace sign-in or a missing session', async () => {
    verdict.mockResolvedValue({ ok: false, status: 401, error: 'Sign in required.' });
    expect((await checkOnboardingAccess(req(cookieFor(OWN)), OWN)).ok).toBe(false);
    verdict.mockResolvedValue({ ok: false, status: 404, error: 'session not found' });
    expect((await checkOnboardingAccess(req(cookieFor(OWN)), OWN)).ok).toBe(false);
  });

  it('ignores a forged or wrongly signed cookie', async () => {
    verdict.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    expect((await checkOnboardingAccess(req(cookieFor(OWN, 'attacker-secret')), OWN)).ok).toBe(false);
    expect((await checkOnboardingAccess(req(`mate_session=${OWN}.deadbeef`), OWN)).ok).toBe(false);
  });
});

describe('cookieSessionId', () => {
  it('needs MATE_SESSION_SECRET to trust anything', () => {
    expect(cookieSessionId(req(cookieFor(OWN)), {})).toBeNull();
    expect(cookieSessionId(req(cookieFor(OWN)))).toBe(OWN);
    expect(cookieSessionId(req('mate_session=%E0%A4%A'))).toBeNull();
  });
});
