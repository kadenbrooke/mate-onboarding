// Telnyx TeXML voice webhook for the Instant First Responder Demo.
//
// The ONE shared demo number (DEMO_TELNYX_NUMBER) points its TeXML voice webhook
// here. Flow, ported from ben-barlow twilio-voice (which forwarded via <Dial>):
//   1. verify the Telnyx signature (fail-closed when a public key is configured),
//   2. normalize the caller ID -> E.164 join key,
//   3. look up the newest READY demo_sessions row for that caller,
//   4. return TeXML that speaks a ~3s "sorry we missed you" line then hangs up,
//   5. fire the missed-call text-back (fr_config.greeting) via Telnyx Messaging
//      immediately so the buzz lands about 5s after the call.
//
// Unknown caller (no ready session — caller ID withheld, or the prospect did not
// run the form): speak the same line and hang up, but send no text (we have no
// number/persona). The code-fallback path (demo-sms) covers withheld caller ID.
import { adminClient, findReadyByPhone, markTexted, upsertConversation } from "../_shared/db.ts"
import { missedCallTexml } from "../_shared/texml.ts"
import { sendSms } from "../_shared/telnyx.ts"
import { toE164 } from "../_shared/normalize.ts"
import { authenticateWebhook } from "../_shared/webhook-auth.ts"

const BUSINESS = "fr_demo"

// TeXML voice posts don't reliably carry Telnyx's Ed25519 headers, so the voice
// webhook authenticates on a shared URL token (?k=DEMO_VOICE_TOKEN) first, with the
// Ed25519 signature kept as a fallback. See _shared/webhook-auth.ts.
const VOICE_TOKEN_ENV = "DEMO_VOICE_TOKEN"

// Generic spoken line for UNKNOWN callers (no ready session -> no business name).
// Kept short (~3s) so it lands before the hangup. Ready sessions instead speak
// their per-business fr_config.voice_line (built deterministically in fr-config.ts).
const GENERIC_MISSED_LINE =
  "Hey, thanks for calling! Sorry we missed you. Shoot us a text so we can get you taken care of."

// M2: run the text-back send off the request's critical path so the TeXML response
// is not gated on the Messaging API (a slow send risks a carrier call-leg timeout).
// EdgeRuntime.waitUntil keeps the function alive until the promise settles without
// blocking the returned Response. Falls back to a bare (non-awaited) call locally.
function runAfterResponse(p: Promise<unknown>): void {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (er?.waitUntil) er.waitUntil(p)
  // else: promise runs detached; local Deno.serve keeps the process alive for tests.
}

/** Fire the missed-call text-back + seed the SMS thread. Runs post-response (M2). */
async function fireTextBack(
  supabase: ReturnType<typeof adminClient>,
  caller: string,
  greeting: string,
  sessionId: string
): Promise<void> {
  const sent = await sendSms(caller, greeting)
  if (sent.ok) {
    // Seed the SMS conversation with the greeting as the assistant's first turn so
    // a reply continues the same thread (demo-sms loads this history).
    await upsertConversation(
      supabase,
      caller,
      BUSINESS,
      [{ role: "assistant", content: greeting }],
      0
    )
    await markTexted(supabase, sessionId)
  }
}

export async function handleVoice(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const authed = await authenticateWebhook(req, rawBody, VOICE_TOKEN_ENV)
  if (!authed) {
    return new Response("unauthorized", { status: 401 })
  }

  // TeXML posts form-encoded params (Twilio-compatible: From, To, CallSid).
  const form = new URLSearchParams(rawBody)
  const caller = toE164(form.get("From") ?? "")

  // Speak a spoken line then hang up. Voice = Matthew (DEMO_VOICE, texml.ts default).
  const respond = (line: string) =>
    new Response(missedCallTexml(line), {
      headers: { "Content-Type": "text/xml" },
    })

  // No usable caller ID -> generic line + hangup, nothing to text (code-fallback
  // handles withheld caller ID via the SMS webhook).
  if (!caller) return respond(GENERIC_MISSED_LINE)

  const supabase = adminClient()
  const session = await findReadyByPhone(supabase, caller)
  if (!session || !session.fr_config) {
    // Unknown caller: no persona built for this number. Generic line + hangup.
    return respond(GENERIC_MISSED_LINE)
  }

  // Ready session: speak the per-business personalized spoken line. Fall back to
  // the generic line if an older persisted session predates voice_line.
  const spokenLine = session.fr_config.voice_line ?? GENERIC_MISSED_LINE

  const greeting =
    session.fr_config.greeting ??
    "Sorry we missed you. What can we help you with?"

  // M2: fire the text-back AFTER the TeXML response, off the critical path, so the
  // spoken audio is never gated on the Messaging API. The call is still
  // ringing/speaking, so the buzz still lands within a few seconds.
  runAfterResponse(fireTextBack(supabase, caller, greeting, session.id))

  return respond(spokenLine)
}

Deno.serve(handleVoice)
