// src/lib/qbo/state.ts
//
// OAuth `state` for CSRF protection on the QBO connect flow. Mirrors the signed
// session-cookie pattern (src/lib/session-cookie.ts): HMAC-SHA256 over the
// payload with a server secret, constant-time compared on the way back.
//
// The state binds the OAuth round-trip to a specific session_id AND a random
// nonce that is also stored in an HttpOnly cookie. On callback we require BOTH
// the signature to verify AND the nonce to match the cookie -- so a forged or
// replayed authorization redirect cannot connect QBO to a session.
//
// Node crypto only (routes run on the node runtime); pure + testable.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export type QbState = { sessionId: string; nonce: string };

function payload(state: QbState): string {
  // Order-fixed, delimiter that cannot appear in a uuid/hex nonce.
  return `${state.sessionId}:${state.nonce}`;
}

function hmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** A fresh random nonce for a new connect attempt. */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Sign a state payload -> "<sessionId>:<nonce>:<hmac>". */
export function signState(state: QbState, secret: string): string {
  return `${payload(state)}:${hmac(payload(state), secret)}`;
}

/** Verify a signed state string. Returns the payload, or null on any mismatch.
 *  Never throws. */
export function verifyState(token: unknown, secret: string): QbState | null {
  if (typeof token !== 'string' || token === '') return null;
  const parts = token.split(':');
  if (parts.length !== 3) return null;
  const [sessionId, nonce, sig] = parts;
  if (!sessionId || !nonce || !sig) return null;
  const expected = hmac(`${sessionId}:${nonce}`, secret);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
  } catch {
    return null;
  }
  return { sessionId, nonce };
}

/** The secret used to sign OAuth state. Dedicated env, falling back to the
 *  existing session secret so a deploy without the new var still protects the
 *  flow. Throws only if neither is set. */
export function qbStateSecret(): string {
  const secret = process.env.QBO_STATE_SECRET || process.env.MATE_SESSION_SECRET;
  if (!secret) throw new Error('QBO_STATE_SECRET (or MATE_SESSION_SECRET) is not set');
  return secret;
}

export const QB_STATE_COOKIE = 'qb_oauth_nonce';
