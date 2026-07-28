// Telnyx TeXML voice webhook for the Instant First Responder Demo (Flow A:
// voicemail-with-transcription + text-back buffer).
//
// The ONE shared demo number (DEMO_TELNYX_NUMBER) points its TeXML voice webhook
// here. This single function handles TWO POSTs from Telnyx for one call:
//
//   1. THE CALL WEBHOOK (initial): speak the personalized line (the "text us or
//      leave a message" invite is now baked into that line, spoken once), then
//      <Record> the caller with transcription on.
//      NO TEXT IS SENT HERE (that changed in Flow A); the text-back now fires from
//      whichever CALLBACK path resolves first (see the exactly-one-text guard).
//        - transcribeCallback -> demo-transcribe (VM path: reference what they said)
//        - action             -> back here (no-VM path: generic buffered text-back)
//
//   2. THE RECORD `action` CALLBACK (recording ended): if RecordingDuration is ~0
//      (caller hung up without leaving a message), CLAIM the single text for this
//      call (idempotent) and SCHEDULE the generic greeting ~DEMO_TEXTBACK_DELAY_
//      SECONDS later via Telnyx send_at, so it feels like a real callback. If a
//      real message WAS left (duration above the no-message threshold), do nothing:
//      demo-transcribe owns that call's one text.
//
// EXACTLY ONE TEXT PER CALL: both the VM path (demo-transcribe) and the no-VM path
// (here) call claimTextForCall(CallSid) before sending. The FIRST to claim wins and
// sends; the other gets false and no-ops. Atomic (demo_counter_bump cap=1): no
// double texts even if both callbacks race.
//
// Unknown caller (no ready session; caller ID withheld, or the prospect did not
// run the form): speak the generic line (invite baked in) and record. The no-VM/VM
// paths still resolve, but with no persona we fall back to a generic text.
import {
  adminClient,
  findReadyByPhone,
  markTexted,
  upsertConversation,
  type DemoSession,
} from "../_shared/db.ts"
import { voicemailTexml } from "../_shared/texml.ts"
import { textbackSendAt } from "../_shared/telnyx.ts"
import { toE164 } from "../_shared/normalize.ts"
import { authenticateWebhook } from "../_shared/webhook-auth.ts"
import {
  callbackUrl,
  claimTextForCall,
  parseCallbackFields,
  sendGuarded,
  NO_MESSAGE_MAX_DURATION_SECONDS,
} from "../_shared/voicemail.ts"

const BUSINESS = "fr_demo"

// Voice webhook + Record action callback both authenticate on the shared URL token
// (?k=DEMO_VOICE_TOKEN); Telnyx TeXML posts don't reliably carry Ed25519 headers.
const VOICE_TOKEN_ENV = "DEMO_VOICE_TOKEN"
// The transcribe callback authenticates on its OWN token (embedded in the URL we
// emit into the TeXML). Kept separate so it can be rotated independently.
const TRANSCRIBE_TOKEN_ENV = "DEMO_TRANSCRIBE_TOKEN"

// Generic SPOKEN line for UNKNOWN callers (no ready session -> no business name).
// This is the COMPLETE spoken message: the voicemail invite is baked in (matching the
// personalized voice_line in fr-config.ts), and VOICEMAIL_INVITE is now empty, so the
// caller hears the "shoot us a text, or leave a message after the beep" invite once.
const GENERIC_MISSED_LINE =
  "Hey, thanks for calling! Sorry we missed you. Shoot us a text, or leave a message after the beep, and we'll get right back with you."

const DEFAULT_GREETING = "Sorry we missed you. What can we help you with?"

// M2: run post-response work off the request's critical path so the TeXML/200 is
// never gated on the Messaging API. EdgeRuntime.waitUntil keeps the function alive
// until the promise settles without blocking the returned Response.
function runAfterResponse(p: Promise<unknown>): void {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (er?.waitUntil) er.waitUntil(p)
}

/**
 * The Record `action` callback (recording ended). NO-VM PATH: when the caller left
 * no message (duration below the no-message threshold), claim the one text for this
 * call and schedule the generic greeting after the buffer. When a real message was
 * left, do nothing here; demo-transcribe owns this call's single text.
 */
async function handleRecordingEnded(
  supabase: ReturnType<typeof adminClient>,
  rawBody: string,
  contentType: string
): Promise<void> {
  const f = parseCallbackFields(rawBody, contentType)
  const caller = toE164(f.from ?? "")
  if (!caller) return // no caller number -> nothing to text

  // A real message was left: the VM path (demo-transcribe) sends the referencing
  // text. Do not also send here. (If the transcribe callback never arrives, the
  // caller still heard the invite; we accept that edge over risking a double text.)
  const dur = f.recordingDurationSeconds ?? 0
  if (dur > NO_MESSAGE_MAX_DURATION_SECONDS) return

  // No message (hung up at/near the beep): this is OUR text to send. Claim it.
  if (!(await claimTextForCall(supabase, f.callId))) return // VM path already claimed

  const session = await findReadyByPhone(supabase, caller)
  const greeting = session?.fr_config?.greeting ?? DEFAULT_GREETING

  // Buffer the generic text so it lands ~DEMO_TEXTBACK_DELAY_SECONDS after the call
  // (feels like a real callback, not an instant bot). Scheduled via Telnyx send_at.
  const sendAt = textbackSendAt()
  if (await sendGuarded(supabase, caller, greeting, sendAt)) {
    // Seed the SMS thread so a reply continues the same conversation.
    await upsertConversation(
      supabase,
      caller,
      BUSINESS,
      [{ role: "assistant", content: greeting }],
      0
    )
    if (session) await markTexted(supabase, session.id)
  }
}

export async function handleVoice(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const authed = await authenticateWebhook(req, rawBody, VOICE_TOKEN_ENV)
  if (!authed) {
    return new Response("unauthorized", { status: 401 })
  }

  const contentType = req.headers.get("content-type") ?? ""

  // Route: the Record `action` callback carries a RecordingDuration (or a recording
  // url); the initial call webhook does not. Presence of a duration => this is the
  // recording-ended callback (no-VM path). We ACK it with an empty 200 (the call
  // already hung up via <Hangup/> in the TeXML) after firing the text-back.
  const preview = parseCallbackFields(rawBody, contentType)
  const isRecordingCallback = preview.recordingDurationSeconds !== null
  if (isRecordingCallback) {
    const supabase = adminClient()
    runAfterResponse(handleRecordingEnded(supabase, rawBody, contentType))
    return new Response("ok", { status: 200 })
  }

  // --- Initial call webhook: emit the voicemail-with-transcription TeXML. ---
  const form = new URLSearchParams(rawBody)
  const caller = toE164(form.get("From") ?? "")

  // Build the two callback URLs the Record verb points at. The transcribe token is
  // read fresh each request (rotation-safe). Empty token in local/dev still yields a
  // well-formed URL; the receiver fails closed on an unset token in prod.
  const transcribeToken = Deno.env.get(TRANSCRIBE_TOKEN_ENV) ?? ""
  const voiceToken = Deno.env.get(VOICE_TOKEN_ENV) ?? ""
  const transcribeUrl = callbackUrl("demo-transcribe", transcribeToken)
  const actionUrl = callbackUrl("demo-voice", voiceToken)

  const respond = (line: string) =>
    new Response(voicemailTexml(line, transcribeUrl, actionUrl), {
      headers: { "Content-Type": "text/xml" },
    })

  // No usable caller ID -> generic line + invite + record.
  if (!caller) return respond(GENERIC_MISSED_LINE)

  const supabase = adminClient()
  const session: DemoSession | null = await findReadyByPhone(supabase, caller)
  if (!session || !session.fr_config) {
    // Unknown caller: no persona built. Generic spoken line, still invite + record.
    return respond(GENERIC_MISSED_LINE)
  }

  // Ready session: speak the per-business personalized spoken line (invite baked into
  // the line itself). Fall back to the generic line for older pre-voice_line rows.
  const spokenLine = session.fr_config.voice_line ?? GENERIC_MISSED_LINE
  return respond(spokenLine)
}

// Only bind the listener as the entrypoint; tests import handleVoice directly.
if (import.meta.main) Deno.serve(handleVoice)
