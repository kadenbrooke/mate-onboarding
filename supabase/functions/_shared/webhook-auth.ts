// Shared webhook authentication for the Instant First Responder Demo edge functions.
//
// Two accepted auth paths, in priority order:
//   (a) SECRET URL TOKEN — the request's `?k=` query param equals a configured
//       shared secret (constant-time compare). This is the primary auth for the
//       VOICE webhook because Telnyx TeXML voice posts (Twilio-compatible, form-
//       encoded) do NOT reliably carry the `telnyx-signature-ed25519` /
//       `telnyx-timestamp` headers that the Messaging API and Call Control layer
//       add — so an Ed25519 check 401s on every real call. A per-webhook token in
//       the URL authenticates the caller without depending on those headers.
//   (b) ED25519 SIGNATURE — a valid Telnyx Ed25519 signature (verifyTelnyx). Kept
//       as a fallback for the voice path (in case Telnyx starts signing TeXML) and
//       as the PRIMARY path for messaging (Messaging API v2 signs reliably).
//
// FAIL-CLOSED: when neither passes, the caller returns 401. Crucially, when the
// token env var is UNSET in production, the token path is simply UNAVAILABLE (it
// never matches an empty configured value) — it does NOT silently open the door.
// The Ed25519 path retains its own fail-closed posture (see verify.ts::verifyTelnyx).
import { verifyTelnyx } from "./verify.ts"

/**
 * Constant-time string comparison. Avoids leaking token length/content via timing.
 * Compares over the max length so mismatched lengths still take constant time.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  const len = Math.max(ab.length, bb.length)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

/**
 * True when the request's `?k=` query param matches the token stored in `envName`.
 * Returns false when the env var is unset/empty (token path unavailable, never open)
 * or when the param is absent/mismatched. Constant-time compare on the value.
 */
export function tokenMatches(req: Request, envName: string): boolean {
  const expected = Deno.env.get(envName)
  if (!expected) return false // token not configured => path unavailable, fail closed
  let provided: string | null = null
  try {
    provided = new URL(req.url).searchParams.get("k")
  } catch {
    provided = null
  }
  if (!provided) return false
  return timingSafeEqual(provided, expected)
}

/**
 * Authenticate a Telnyx-facing webhook. Accepts the request when EITHER the URL
 * token (env `tokenEnvName`) matches OR a valid Ed25519 signature is present.
 * `rawBody` is the already-read request body (callers read it once and pass it in,
 * since the body stream can only be consumed once).
 */
export async function authenticateWebhook(
  req: Request,
  rawBody: string,
  tokenEnvName: string
): Promise<boolean> {
  // (a) URL token — cheap, header-independent, primary for TeXML voice.
  if (tokenMatches(req, tokenEnvName)) return true
  // (b) Ed25519 signature — fallback/primary-for-messaging.
  return await verifyTelnyx(
    rawBody,
    req.headers.get("telnyx-signature-ed25519"),
    req.headers.get("telnyx-timestamp")
  )
}
