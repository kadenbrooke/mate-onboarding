// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkGoogleCallback, googleStateSecret, newGoogleNonce, signGoogleState, verifyGoogleState } from './google-oauth-state';

const SECRET = 'state-test-secret';
const NOW = 1_800_000_000_000;
const base = { sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', nonce: 'n1', userId: 'u1', exp: NOW + 600_000 };

describe('signGoogleState / verifyGoogleState', () => {
  it('round-trips the payload', () => {
    expect(verifyGoogleState(signGoogleState(base, SECRET), SECRET)).toEqual(base);
  });

  it('rejects another key, a tampered payload, and junk', () => {
    const token = signGoogleState(base, SECRET);
    expect(verifyGoogleState(token, 'other-key')).toBeNull();
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'bbbbbbbb-0000-4000-8000-000000000002', n: 'n1', u: 'u1', e: base.exp })).toString('base64url');
    expect(verifyGoogleState(`${forged}.${sig}`, SECRET)).toBeNull();
    for (const junk of [null, '', base.sessionId, 'a.b.c', `${token}x`]) expect(verifyGoogleState(junk, SECRET)).toBeNull();
  });

  it('makes a fresh nonce each time', () => {
    expect(newGoogleNonce()).not.toBe(newGoogleNonce());
  });
});

describe('checkGoogleCallback', () => {
  const ok = { state: signGoogleState(base, SECRET), cookieNonce: 'n1', userId: 'u1', secret: SECRET, now: NOW };

  it('passes a valid callback and returns the signed session', () => {
    expect(checkGoogleCallback(ok)).toEqual({ ok: true, sessionId: base.sessionId });
  });
  it('refuses a forged state', () => {
    expect(checkGoogleCallback({ ...ok, state: base.sessionId })).toEqual({ ok: false, reason: 'bad-state' });
  });
  it('refuses an expired state', () => {
    expect(checkGoogleCallback({ ...ok, now: base.exp + 1 })).toEqual({ ok: false, reason: 'expired' });
  });
  it('refuses a missing or mismatched nonce cookie', () => {
    expect(checkGoogleCallback({ ...ok, cookieNonce: undefined })).toEqual({ ok: false, reason: 'nonce-mismatch' });
    expect(checkGoogleCallback({ ...ok, cookieNonce: 'n2' })).toEqual({ ok: false, reason: 'nonce-mismatch' });
  });
  it('refuses another user, or nobody signed in', () => {
    expect(checkGoogleCallback({ ...ok, userId: 'u2' })).toEqual({ ok: false, reason: 'wrong-user' });
    expect(checkGoogleCallback({ ...ok, userId: null })).toEqual({ ok: false, reason: 'wrong-user' });
  });
});

describe('googleStateSecret', () => {
  it('prefers its own variable, falls back to the session secret, and refuses neither', () => {
    expect(googleStateSecret({ GOOGLE_OAUTH_STATE_SECRET: 'a', MATE_SESSION_SECRET: 'b' })).toBe('a');
    expect(googleStateSecret({ MATE_SESSION_SECRET: 'b' })).toBe('b');
    expect(() => googleStateSecret({})).toThrow();
  });
});
