// Telnyx TeXML call-lifecycle StatusCallback handler for the Instant First
// Responder Demo (Flow A) -- the HANGUP CATCH-ALL / SAFETY NET.
//
// WHY THIS EXISTS. Text-back fires from exactly two callback paths today:
//   - the Record `action` callback (no-VM path, in demo-voice), and
//   - the transcribe callback (VM path, in demo-transcribe).
// Both require the call to reach the <Record> stage. A caller who hangs up WHILE
// RINGING, or DURING THE SPOKEN GREETING before the Record beep, reaches NEITHER
// callback -> they get NO text. This function closes that gap: the TeXML app's
// Status Callback URL (call lifecycle / hangup events) points here, and on call end
// we ensure the caller gets the generic greeting text IF no other path sent one.
//
// THE ORDERING GUARANTEE (the hard part). A voicemail-leaver must get the
// message-REFERENCING text (demo-transcribe), NEVER a generic pre-empt. But the
// hangup StatusCallback fires IMMEDIATELY at hangup, while the transcribe callback
// arrives ~10-20s later. So this handler must NOT claim+send a generic right away.
// Instead it DEFERS (runHangupCatchall): wait DEMO_HANGUP_CATCHALL_DELAY_SECONDS,
// THEN claimTextForCall (claim-at-FIRE). By fire time any real path (referencing VM,
// or the no-VM Record `action` which claims immediately) has already claimed the
// CallSid, so this handler's claim returns false and it no-ops. It sends ONLY on a
// true early hangup where no other path exists. Exactly one text, every case.
//
// AUTH. Token-auth on the SHARED voice token (?k=DEMO_VOICE_TOKEN), same trust
// domain and fail-closed posture as demo-voice: Telnyx TeXML posts don't reliably
// Ed25519-sign, so the URL token is the primary gate (constant-time compared; the
// token path is UNAVAILABLE, never open, when the env is unset in prod). Reusing the
// voice token (rather than minting a new secret) keeps the voice-path surface to one
// rotatable secret; the Ed25519 fallback still applies if Telnyx ever signs TeXML.
//
// EXACTLY ONE TEXT. This is the FOURTH path onto claimTextForCall(CallSid) -- the
// single atomic dedupe point shared by transcribe, Record action, and now hangup.
// The initial call webhook still sends nothing. No new migration: the claim reuses
// demo_counter_bump('text_sent', CallSid, cap=1).
import { adminClient, findReadyByPhone } from "../_shared/db.ts"
import { toE164 } from "../_shared/normalize.ts"
import { authenticateWebhook } from "../_shared/webhook-auth.ts"
import {
  hangupCatchallDelaySeconds,
  parseCallbackFields,
  runHangupCatchall,
} from "../_shared/voicemail.ts"

// Same token as the voice webhook + Record action callback (shared voice trust
// domain). Telnyx TeXML StatusCallback posts don't reliably Ed25519-sign, so this
// ?k= token is the primary auth; it fails CLOSED when unset in prod.
const VOICE_TOKEN_ENV = "DEMO_VOICE_TOKEN"

const DEFAULT_GREETING = "Sorry we missed you. What can we help you with?"

// M2 parity: run the deferred catch-all OFF the response's critical path so the 200
// ACK to Telnyx is never gated on the sleep+claim+send. EdgeRuntime.waitUntil keeps
// the function alive until the promise settles without blocking the returned 200.
function runAfterResponse(p: Promise<unknown>): void {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (er?.waitUntil) er.waitUntil(p)
}

/**
 * The deferred safety-net body: look up the caller's ready session, then run the
 * claim-at-fire catch-all. Kept separate from the request handler so the handler
 * can ACK immediately and this runs under waitUntil.
 */
export async function handleCallEnded(
  supabase: ReturnType<typeof adminClient>,
  rawBody: string,
  contentType: string
): Promise<void> {
  const f = parseCallbackFields(rawBody, contentType)
  const caller = toE164(f.from ?? "")
  // No caller number / no CallSid -> nothing to text, nothing to dedupe on.
  if (!caller || !f.callId) return

  // Unknown caller (no ready session) -> the demo only texts form-submitters; do
  // nothing (parity with demo-voice/demo-transcribe unknown-caller handling).
  const session = await findReadyByPhone(supabase, caller)
  if (!session) return

  const greeting = session.fr_config?.greeting ?? DEFAULT_GREETING

  // Deferred claim-at-fire: waits past the referencing/no-VM paths, then claims. If
  // another path already claimed, no-op; else send the generic (true early hangup).
  await runHangupCatchall(supabase, {
    callId: f.callId,
    caller,
    hasReadySession: true,
    greeting,
    delaySeconds: hangupCatchallDelaySeconds(),
  })
}

export async function handleCallStatus(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const authed = await authenticateWebhook(req, rawBody, VOICE_TOKEN_ENV)
  if (!authed) return new Response("unauthorized", { status: 401 })

  const contentType = req.headers.get("content-type") ?? ""

  // ACK immediately; the safety-net work (which SLEEPS for the buffer) runs off the
  // critical path. Telnyx just needs the 200 for the lifecycle event.
  const supabase = adminClient()
  runAfterResponse(handleCallEnded(supabase, rawBody, contentType))
  return new Response("ok", { status: 200 })
}

// Only bind the listener as the entrypoint; tests import handleCallStatus directly.
if (import.meta.main) Deno.serve(handleCallStatus)
