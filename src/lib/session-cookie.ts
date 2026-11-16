/**
 * Signed session cookie (phase-2 hardening). Format: "<sessionId>.<hmac>",
 * HMAC-SHA256 over the id with MATE_SESSION_SECRET. HttpOnly cookie set at
 * session creation. It never replaces a session a request names: it is proof
 * of creation for that exact session in lib/portal/onboarding-gate, and
 * /api/portal falls back to it only when no ?session= is given.
 *
 * Node crypto only (routes run on the node runtime); pure + testable.
 */
import { createHmac, timingSafeEqual } from "crypto"

export const COOKIE_NAME = "mate_session"

function hmac(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("hex")
}

export function signSession(sessionId: string, secret: string): string {
  return `${sessionId}.${hmac(sessionId, secret)}`
}

/** The verified session id, or null. Never throws. */
export function verifySession(token: unknown, secret: string): string | null {
  if (typeof token !== "string" || token === "") return null
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null
  const id = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = hmac(id, secret)
  if (sig.length !== expected.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null
  } catch {
    return null
  }
  return id
}
