// OAuth `state` for the Google connect flow (/api/connect/google and its
// callback).
//
// The callback stores a Google refresh token on a session and syncs that
// calendar into it, so it must only ever finish a flow THIS browser started,
// for THIS session, as THIS user, recently. A bare session id in `state` (the
// old shape) let anyone forge a callback for a known session and attach their
// own Google account to it.
//
// Same idea as the QuickBooks flow (lib/qbo/state.ts), plus a user and an
// expiry: the start leg signs { sessionId, nonce, userId, exp } with HMAC-SHA256
// and puts the nonce in a short-lived httpOnly SameSite=Lax cookie. The callback
// (checkGoogleCallback) requires, before any code exchange:
//   1. the signature verifies (nothing in the state was changed),
//   2. it has not expired (GOOGLE_STATE_TTL_MS),
//   3. the nonce cookie is present and equals the state's nonce (this browser
//      started this flow),
//   4. the signed-in user is the one who started it,
//   5. (in the callback route) the nonce has not been used before: it is
//      claimed once in the atomic demo_counter_bump counter (cap 1), so a
//      replayed callback, even with the cookie still present, is refused.
//      That counter is per UTC day, so a flow must also finish on the UTC day
//      it started (otherwise it counts as expired and is simply restarted).
//
// Node crypto only; pure + testable. Never throws on bad input.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export type GoogleState = { sessionId: string; nonce: string; userId: string; exp: number };

export const GOOGLE_STATE_COOKIE = 'google_oauth_nonce';
/** Ten minutes to finish Google's consent screen. Also the cookie's max age. */
export const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
/** demo_counter_bump scope that records each nonce once (single use). */
export const GOOGLE_NONCE_SCOPE = 'google_oauth_nonce';

/** The counter key for a nonce: its SHA-256, so the raw nonce is never stored. */
export function nonceKey(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');
const hmac = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url');

/** A fresh random nonce for one connect attempt. */
export function newGoogleNonce(): string {
  return randomBytes(16).toString('hex');
}

/** The secret that signs the state. Dedicated env, else the session secret. Throws if neither is set. */
export function googleStateSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.GOOGLE_OAUTH_STATE_SECRET || env.MATE_SESSION_SECRET;
  if (!secret) throw new Error('GOOGLE_OAUTH_STATE_SECRET (or MATE_SESSION_SECRET) is not set');
  return secret;
}

/** "<base64url JSON payload>.<base64url HMAC>". */
export function signGoogleState(state: GoogleState, secret: string): string {
  const body = b64(JSON.stringify({ s: state.sessionId, n: state.nonce, u: state.userId, e: state.exp }));
  return `${body}.${hmac(body, secret)}`;
}

/** The signed payload, or null on any tampering or malformed input. Does not check expiry. */
export function verifyGoogleState(token: unknown, secret: string): GoogleState | null {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), 'utf8');
  const expected = Buffer.from(hmac(body, secret), 'utf8');
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(unb64(body)) as { s?: unknown; n?: unknown; u?: unknown; e?: unknown };
    if (typeof p.s !== 'string' || !p.s || typeof p.n !== 'string' || !p.n) return null;
    if (typeof p.u !== 'string' || !p.u || typeof p.e !== 'number') return null;
    return { sessionId: p.s, nonce: p.n, userId: p.u, exp: p.e };
  } catch {
    return null;
  }
}

export type GoogleCallbackCheck =
  | { ok: true; sessionId: string; nonce: string }
  | { ok: false; reason: 'bad-state' | 'expired' | 'nonce-mismatch' | 'wrong-user' };

/** Every check the callback needs before it may exchange the code. */
export function checkGoogleCallback(input: {
  state: string | null;
  cookieNonce: string | null | undefined;
  userId: string | null | undefined;
  secret: string;
  now?: number;
}): GoogleCallbackCheck {
  const state = verifyGoogleState(input.state, input.secret);
  if (!state) return { ok: false, reason: 'bad-state' };
  const now = input.now ?? Date.now();
  if (now > state.exp) return { ok: false, reason: 'expired' };
  // The single-use record is per UTC day: a flow must finish on the day it started.
  if (utcDay(state.exp - GOOGLE_STATE_TTL_MS) !== utcDay(now)) return { ok: false, reason: 'expired' };
  const cookie = Buffer.from(input.cookieNonce ?? '', 'utf8');
  const nonce = Buffer.from(state.nonce, 'utf8');
  if (cookie.length !== nonce.length || !timingSafeEqual(cookie, nonce)) return { ok: false, reason: 'nonce-mismatch' };
  if (!input.userId || input.userId !== state.userId) return { ok: false, reason: 'wrong-user' };
  return { ok: true, sessionId: state.sessionId, nonce: state.nonce };
}
