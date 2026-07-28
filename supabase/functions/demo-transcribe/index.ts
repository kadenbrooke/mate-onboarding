// Telnyx TeXML transcription callback for the Instant First Responder Demo (Flow A,
// VM path). The <Record transcribe="true" transcribeCallback="{this}?k=TOKEN"/> in
// demo-voice's TeXML points here. Telnyx transcribes the caller's voicemail and
// POSTs the transcript; we craft a warm text that REFERENCES what they said and
// send it, so the demo lands the "wow": VM "need my driveway sealed before winter"
// -> text "Got your message about sealing your driveway before winter, what day
// works for a quick quote?".
//
// AUTH: this is a PUBLIC webhook. Telnyx TeXML callbacks do NOT reliably Ed25519-
// sign, so the ONLY real auth here is the ?k=DEMO_TRANSCRIBE_TOKEN URL token
// (constant-time compared; fails CLOSED when the token env is unset in prod). Same
// pattern as the voice/sms webhooks.
//
// EXACTLY ONE TEXT PER CALL: before sending we claim the single text for this call
// (claimTextForCall(CallSid), atomic cap=1). If the no-VM action path already
// claimed it (shouldn't happen for a real message, but the guard makes it safe),
// we no-op. So a call yields exactly one outbound text no matter which path fires.
//
// FAILED/EMPTY TRANSCRIPTION NEVER = SILENCE: for a REAL message (duration above the
// no-message threshold) the no-VM action path early-returns, so if the transcript
// comes back "failed" or empty this callback is the ONLY path that fires. We still
// claim + send the GENERIC personalized greeting (fr_config.greeting) so the caller
// who left a voicemail always gets at least a callback, never silence. A usable
// transcript still gets the message-REFERENCING text. (Residual gap: a "failed"
// transcribe callback that never ARRIVES at all -- a lost webhook -- can't be closed
// without a timer; that's out of scope. The common failed/empty cases are covered.)
//
// COST/ABUSE: the send goes through the SAME global outbound-SMS breaker
// (sendGuarded) the qualify loop uses, and the model call is now ALSO bounded by a
// global model-spend counter bumped BEFORE craftVmReply -- so forged CallSids can't
// rack up model spend before the SMS breaker is consulted. Token auth is the primary
// gate; these are defense-in-depth. The transcript is sanitized + FENCED as untrusted
// caller data before it touches the model (prompt-injection parity with fr-config.ts).
import { adminClient, findReadyByPhone, upsertConversation } from "../_shared/db.ts"
import { toE164 } from "../_shared/normalize.ts"
import { authenticateWebhook } from "../_shared/webhook-auth.ts"
import { generateReply } from "../_shared/portkey.ts"
import { bumpCounter } from "../_shared/counter.ts"
import {
  buildVmReplyMessages,
  claimTextForCall,
  MODEL_SPEND_SCOPE,
  modelSpendCap,
  parseCallbackFields,
  sendGuarded,
} from "../_shared/voicemail.ts"
import { sanitizeTranscript } from "../_shared/sanitize.ts"

const BUSINESS = "fr_demo"
const TRANSCRIBE_TOKEN_ENV = "DEMO_TRANSCRIBE_TOKEN"

// Generic personalized callback line when the transcript is unusable (failed /
// empty transcription) but a real message WAS left. We can't reference what they
// said, so we fall back to the same warm no-VM greeting rather than sending nothing.
const DEFAULT_GREETING = "Sorry we missed you. What can we help you with?"

// Persona system prompt fallback when the caller has no ready session (unknown
// caller / withheld-then-recorded). We still reference their message, just in a
// neutral First Responder voice rather than a business-specific one.
const GENERIC_PERSONA =
  "You are a friendly, professional first responder texting a caller back on behalf " +
  "of a local service business. Keep it warm and concise."

/**
 * Craft the VM-referencing SMS body (pure enough to unit test with an injected
 * generateReply). system: the per-session persona; rawTranscript: the caller's
 * (untrusted) voicemail text. Returns the model reply, or a safe canned line that
 * still references "your message" when the model returns nothing.
 */
export async function craftVmReply(
  system: string,
  rawTranscript: unknown,
  generate: (sys: string, msgs: ReturnType<typeof buildVmReplyMessages>) => Promise<string> = generateReply
): Promise<string> {
  const reply = await generate(system, buildVmReplyMessages(rawTranscript))
  if (reply && reply.trim() !== "") return reply.trim()
  // Fallback: still acknowledge the message concretely without a model call.
  const clean = sanitizeTranscript(rawTranscript)
  return clean === ""
    ? "Thanks for your message! What day works for a quick call?"
    : "Thanks for your message! Someone will follow up shortly to help you out."
}

export async function handleTranscribe(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const authed = await authenticateWebhook(req, rawBody, TRANSCRIBE_TOKEN_ENV)
  if (!authed) return new Response("unauthorized", { status: 401 })

  const contentType = req.headers.get("content-type") ?? ""
  const f = parseCallbackFields(rawBody, contentType)
  const caller = toE164(f.from ?? "")
  // No caller number -> nothing to text. Ack so Telnyx doesn't retry.
  if (!caller) return new Response("ok", { status: 200 })

  const supabase = adminClient()

  // Is the transcript USABLE? A "failed" status OR an empty-after-sanitize body
  // means we CANNOT reference what the caller said. Previously we returned here and
  // left the no-VM action path to send the generic text -- but for a REAL message
  // (RecordingDuration above the no-message threshold) that action path early-
  // returns, so NEITHER path sent and the caller got silence. Now we still claim +
  // send the generic personalized greeting so a real voicemail always yields at
  // least the generic callback. A usable transcript still gets the REFERENCING text.
  const status = (f.transcriptionStatus ?? "").toLowerCase()
  const transcript = f.transcriptionText ?? ""
  const usable = status !== "failed" && sanitizeTranscript(transcript) !== ""

  // EXACTLY ONE TEXT: claim this call's single text BEFORE any model spend. If the
  // no-VM action path beat us (e.g. a race, or a short/misclassified recording it
  // already handled), no-op -- the claim dedupes so exactly-one-text still holds.
  if (!(await claimTextForCall(supabase, f.callId))) {
    return new Response("ok", { status: 200 })
  }

  const session = await findReadyByPhone(supabase, caller)

  // Craft the outbound body. Usable transcript -> REFERENCING reply (one model
  // call). Unusable -> generic personalized greeting, NO model call.
  let reply: string
  if (usable) {
    // COST/ABUSE (defense-in-depth): bump the global model-spend counter BEFORE the
    // model call, so a flood of forged CallSids (post token-leak) is bounded on
    // model spend too, not just on the SMS breaker downstream. Token auth is still
    // the primary gate; the claim above already deduped a legit call to one bump.
    if (!(await bumpCounter(supabase, MODEL_SPEND_SCOPE, "-", modelSpendCap()))) {
      // Model-spend breaker tripped: skip the model, fall back to the generic line
      // so the caller still gets a callback (the claim is already spent, so this is
      // still exactly one text).
      reply = session?.fr_config?.greeting ?? DEFAULT_GREETING
    } else {
      const persona = session?.fr_config?.system_prompt ?? GENERIC_PERSONA
      reply = await craftVmReply(persona, transcript)
    }
  } else {
    // Unusable transcript (failed/empty): generic personalized greeting, no model.
    reply = session?.fr_config?.greeting ?? DEFAULT_GREETING
  }

  // Send under the SAME global breaker as the qualify loop (not a new spend path).
  // No buffer here: transcription latency is already the natural "callback" delay.
  const sent = await sendGuarded(supabase, caller, reply)
  if (sent) {
    // Seed the SMS thread so the ongoing SMS agent has full context. For a usable
    // transcript, seed BOTH the voicemail turn (SANITIZED, never the raw caller
    // string) and our sent text. For an unusable transcript there is no caller text
    // worth storing, so seed only our assistant turn (parity with the no-VM path).
    const turns = usable
      ? [
          { role: "user" as const, content: `[voicemail] ${sanitizeTranscript(transcript)}` },
          { role: "assistant" as const, content: reply },
        ]
      : [{ role: "assistant" as const, content: reply }]
    await upsertConversation(supabase, caller, BUSINESS, turns, 0)
  }
  return new Response("ok", { status: 200 })
}

// Only bind the listener when run as the entrypoint (import.meta.main). Tests
// import craftVmReply / handleTranscribe without starting a server.
if (import.meta.main) Deno.serve(handleTranscribe)
