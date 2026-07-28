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
// COST/ABUSE: the send + the model call go through the SAME global outbound-SMS
// breaker (sendGuarded) the qualify loop uses, so this is not a new uncapped spend
// path. The transcript is sanitized + FENCED as untrusted caller data before it
// touches the model (prompt-injection parity with fr-config.ts).
import { adminClient, findReadyByPhone, upsertConversation } from "../_shared/db.ts"
import { toE164 } from "../_shared/normalize.ts"
import { authenticateWebhook } from "../_shared/webhook-auth.ts"
import { generateReply } from "../_shared/portkey.ts"
import {
  buildVmReplyMessages,
  claimTextForCall,
  parseCallbackFields,
  sendGuarded,
} from "../_shared/voicemail.ts"
import { sanitizeTranscript } from "../_shared/sanitize.ts"

const BUSINESS = "fr_demo"
const TRANSCRIBE_TOKEN_ENV = "DEMO_TRANSCRIBE_TOKEN"

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

  // A failed/empty transcription: let the no-VM action path handle the generic
  // text-back (it will claim the one text). Do not claim or send here.
  const status = (f.transcriptionStatus ?? "").toLowerCase()
  const transcript = f.transcriptionText ?? ""
  if (status === "failed" || sanitizeTranscript(transcript) === "") {
    return new Response("ok", { status: 200 })
  }

  const supabase = adminClient()

  // EXACTLY ONE TEXT: claim this call's single text. If the no-VM path beat us
  // (unexpected for a real message), no-op.
  if (!(await claimTextForCall(supabase, f.callId))) {
    return new Response("ok", { status: 200 })
  }

  const session = await findReadyByPhone(supabase, caller)
  const persona = session?.fr_config?.system_prompt ?? GENERIC_PERSONA

  // Craft the referencing reply (transcript sanitized + fenced inside).
  const reply = await craftVmReply(persona, transcript)

  // Send under the SAME global breaker as the qualify loop (not a new spend path).
  // No buffer here: transcription latency is already the natural "callback" delay.
  const sent = await sendGuarded(supabase, caller, reply)
  if (sent) {
    // Seed the SMS thread with BOTH the voicemail (as the caller's turn) and our
    // sent text (assistant turn) so the ongoing SMS agent has full context. The
    // voicemail is stored SANITIZED (never the raw caller string) for parity with
    // how inbound texts are handled.
    await upsertConversation(
      supabase,
      caller,
      BUSINESS,
      [
        { role: "user", content: `[voicemail] ${sanitizeTranscript(transcript)}` },
        { role: "assistant", content: reply },
      ],
      0
    )
  }
  return new Response("ok", { status: 200 })
}

// Only bind the listener when run as the entrypoint (import.meta.main). Tests
// import craftVmReply / handleTranscribe without starting a server.
if (import.meta.main) Deno.serve(handleTranscribe)
