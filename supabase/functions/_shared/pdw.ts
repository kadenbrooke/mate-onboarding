// PDW CRM SMS-consent divert helpers for demo-sms.
//
// The Auto Mate number doubles as the opt-in rail for the PDW CRM text alerts:
// an alert recipient texts YES to turn alerts on and STOP to turn them off.
// When PDW_SMS_DIVERT_URL is set AND an inbound Telnyx message is exactly one
// consent keyword, demo-sms forwards the UNCHANGED raw webhook body plus the two
// Telnyx signature headers to that URL (an n8n workflow that verifies the
// Ed25519 signature over the raw body and asks the PDW CRM). The workflow answers
// 200 {handled: true|false, result}; handled:true means the CRM took the text and
// demo-sms must stop (no demo reply, no demo state change).
//
// Design constraints (deliberate):
//   - ENV-GATED: PDW_SMS_DIVERT_URL unset => pdwDivertUrl() returns null and
//     demo-sms behaves exactly as before. A non-https value is treated as unset.
//   - KEYWORDS ONLY: only an inbound `message.received` event whose whole text is
//     one keyword is ever forwarded. Every other text never leaves demo-sms.
//   - FAIL-OPEN: anything but 200 + handled:true (handled:false, non-200, timeout,
//     network error, bad JSON) returns false, so the demo paths run unchanged.
//     The CRM being down must NEVER break the live client demo.
//   - NO BODIES OR NUMBERS IN LOGS: the outcome lines name only the status/error
//     kind. The keyword itself is the whole message body, so it is not logged.

/** Opt-out keywords (Telnyx's standard set). The rest opt in or ask for help. */
export const PDW_OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
])
const PDW_KEYWORDS = new Set([...PDW_OPT_OUT_KEYWORDS, "YES", "START", "UNSTOP", "HELP"])

/** How long demo-sms waits on the divert before falling through to the demo. */
export const PDW_DIVERT_TIMEOUT_MS = 3000

/**
 * The consent keyword this text is (upper-cased), or null. Matches the whole
 * text only: trimmed, case-insensitive, trailing punctuation ignored, so
 * "yes", " Yes! " and "STOP." match but "yes please" and "stop it" do not.
 */
export function pdwKeyword(text: string): string | null {
  const word = text.trim().replace(/[\p{P}\s]+$/u, "").toUpperCase()
  return PDW_KEYWORDS.has(word) ? word : null
}

/** The divert target, or null when unset or not an https URL (divert disabled). */
export function pdwDivertUrl(): string | null {
  const raw = Deno.env.get("PDW_SMS_DIVERT_URL")
  if (!raw) return null
  try {
    if (new URL(raw).protocol === "https:") return raw
  } catch {
    // fall through to the disabled log below
  }
  console.error("pdw divert disabled: PDW_SMS_DIVERT_URL is not an https URL")
  return null
}

/**
 * Forward the raw webhook to the PDW consent workflow. Returns true ONLY when it
 * answers 200 with handled:true (the caller then ACKs Telnyx and stops). Every
 * other outcome returns false (fail-open). Skips the call when either Telnyx
 * signature header is missing: the workflow verifies the signature, so an
 * unsigned forward could only be refused, and skipping saves the timeout.
 */
export async function pdwDivert(
  url: string,
  rawBytes: ArrayBuffer,
  headers: Headers
): Promise<boolean> {
  const signature = headers.get("telnyx-signature-ed25519")
  const timestamp = headers.get("telnyx-timestamp")
  if (!signature || !timestamp) {
    console.error("pdw divert skipped: unsigned request")
    return false
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": headers.get("content-type") ?? "application/json",
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      },
      body: rawBytes,
      signal: AbortSignal.timeout(PDW_DIVERT_TIMEOUT_MS),
    })
    if (res.status !== 200) {
      await res.body?.cancel()
      console.error(`pdw divert fell through: status ${res.status}`)
      return false
    }
    const json = await res.json()
    if (json?.handled === true) return true
    console.error("pdw divert fell through: not handled")
    return false
  } catch (err) {
    const kind = err instanceof Error ? err.name : "unknown"
    console.error(`pdw divert fell through: ${kind}`)
    return false
  }
}
