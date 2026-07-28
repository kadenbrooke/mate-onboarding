// Telnyx webhook signature verification (Ed25519).
//
// Telnyx signs every webhook with the account's PUBLIC key. The signature is over
// `${timestamp}|${rawBody}`, delivered in headers:
//   telnyx-signature-ed25519  (base64 signature)
//   telnyx-timestamp          (unix seconds)
// TELNYX_PUBLIC_KEY is the base64 Ed25519 public key from the Telnyx portal.
//
// FAIL-CLOSED IN PRODUCTION (CRITICAL FIX C3): if TELNYX_PUBLIC_KEY is unset, we
// only skip verification in a LOCAL/DEV context. In production an unset key REJECTS
// every request rather than silently accepting forged webhooks. "Production" is
// detected by DENO_DEPLOYMENT_ID (set by Supabase Edge / Deno Deploy) or an explicit
// DEMO_ENV=production secret. The dev-skip is documented and intentional: local runs
// exercise the flow without live signing; go-live MUST set the key.

/** True when running in a deployed/production context (not local dev). */
export function isProd(): boolean {
  // DENO_DEPLOYMENT_ID is injected by Supabase Edge Functions / Deno Deploy in any
  // hosted context. DEMO_ENV=production is an explicit override for other hosts.
  if (Deno.env.get("DENO_DEPLOYMENT_ID")) return true
  if ((Deno.env.get("DEMO_ENV") ?? "").toLowerCase() === "production") return true
  return false
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Verify a Telnyx webhook. Returns true when valid, or when no public key is
 * configured AND we are in local dev (documented dev-skip). Returns false when a
 * key IS configured and the signature does not check out, OR when no key is set in
 * production (fail closed). Never throws.
 */
export async function verifyTelnyx(
  rawBody: string,
  signatureB64: string | null,
  timestamp: string | null
): Promise<boolean> {
  const publicKeyB64 = Deno.env.get("TELNYX_PUBLIC_KEY")
  if (!publicKeyB64) {
    // No key: fail CLOSED in production, dev-skip only locally.
    return !isProd()
  }
  if (!signatureB64 || !timestamp) return false

  try {
    const signedPayload = new TextEncoder().encode(`${timestamp}|${rawBody}`)
    const key = await crypto.subtle.importKey(
      "raw",
      b64ToBytes(publicKeyB64),
      { name: "Ed25519" },
      false,
      ["verify"]
    )
    return await crypto.subtle.verify("Ed25519", key, b64ToBytes(signatureB64), signedPayload)
  } catch {
    return false
  }
}
