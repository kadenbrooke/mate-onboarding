/**
 * Signed "pending access code" cookie. Carries the access code a Google-signup
 * user reserved across the OAuth redirect so the /auth/callback route can claim
 * it once Google returns. Signing (same HMAC style as session-cookie.ts, keyed
 * by MATE_SESSION_SECRET) means a stale or injected cookie cannot silently bind
 * a code on a plain login: only a value this server signed verifies.
 *
 * Node crypto only (the route runs on the node runtime); pure + testable.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const PENDING_CODE_COOKIE = "mate_pending_code";

function secret(): string {
  const s = process.env.MATE_SESSION_SECRET;
  if (!s) throw new Error("MATE_SESSION_SECRET is not set");
  return s;
}

function hmac(code: string): string {
  return createHmac("sha256", secret()).update(code).digest("hex");
}

export function signPendingCode(code: string): string {
  return `${code}.${hmac(code)}`;
}

/** The verified access code, or null. Never throws on malformed input. */
export function verifyPendingCode(raw: string | undefined): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const code = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let expected: string;
  try {
    expected = hmac(code);
  } catch {
    return null;
  }
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return code;
}
