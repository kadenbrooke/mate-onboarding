// Telnyx Messaging API helper for the Instant First Responder Demo.
//
// Ported from the ben-barlow lead-capture _shared/notify.ts::sendAlertSms, which
// used the Twilio Messages REST endpoint. Telnyx's equivalent is a JSON POST to
// https://api.telnyx.com/v2/messages with a Bearer API key (TELNYX_API_KEY).
// Outbound uses a messaging_profile_id or a `from` number; we send `from` the
// shared demo number (DEMO_TELNYX_NUMBER) so the text-back appears to come from
// the number the prospect just called.
//
// Best-effort: no-ops when Telnyx env is unset (pre-account / not provisioned) so
// local runs and the pre-go-live state never throw.

export interface SendSmsResult {
  ok: boolean
  status?: number
  error?: string
  skipped?: boolean
}

/**
 * Send an SMS via the Telnyx Messaging API. Returns a result object rather than
 * throwing so the webhook can log and continue. Skips (ok:false, skipped:true)
 * when the API key or from-number is missing.
 *
 * `sendAtIso` (optional): an ISO 8601 UTC timestamp. When set, Telnyx SCHEDULES
 * the message for that time (`send_at`) instead of sending immediately, so we get
 * the "feels like a real callback" buffer WITHOUT keeping a function alive. Telnyx
 * honours send_at to about one-minute accuracy (per Telnyx scheduled-messaging
 * docs), so a ~30s buffer lands within the same or next minute, good enough for
 * the demo's "not an instant bot" feel. A past/near-now send_at just sends now.
 */
export async function sendSms(
  to: string,
  text: string,
  sendAtIso?: string
): Promise<SendSmsResult> {
  const apiKey = Deno.env.get("TELNYX_API_KEY")
  const from = Deno.env.get("DEMO_TELNYX_NUMBER")
  const profileId = Deno.env.get("TELNYX_MESSAGING_PROFILE_ID")
  if (!apiKey || !from) {
    return { ok: false, skipped: true, error: "TELNYX_API_KEY or DEMO_TELNYX_NUMBER unset" }
  }

  const payload: Record<string, unknown> = { from, to, text }
  // A messaging_profile_id is optional when `from` is a number on the account,
  // but including it (when set) makes routing explicit for 10DLC/long-code.
  if (profileId) payload.messaging_profile_id = profileId
  // Scheduled send: only attach when a valid future-ish ISO string was passed.
  if (sendAtIso) payload.send_at = sendAtIso

  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, status: res.status, error: body.slice(0, 500) }
    }
    return { ok: true, status: res.status }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
}

/**
 * Compute the ISO 8601 UTC `send_at` for a text-back buffer: now + delaySeconds.
 * Reads DEMO_TEXTBACK_DELAY_SECONDS (default 30). A non-positive / non-finite /
 * unset value yields undefined (send immediately, no scheduling). Pure + testable;
 * `now` is injectable so tests don't depend on wall-clock.
 */
export function textbackSendAt(now: Date = new Date()): string | undefined {
  const raw = Deno.env.get("DEMO_TEXTBACK_DELAY_SECONDS")
  const secs = raw === undefined || raw === "" ? 30 : Number(raw)
  if (!Number.isFinite(secs) || secs <= 0) return undefined
  return new Date(now.getTime() + secs * 1000).toISOString()
}
