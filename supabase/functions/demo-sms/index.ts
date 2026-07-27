// Telnyx Messaging webhook for the Instant First Responder Demo.
//
// The shared demo number's inbound-SMS webhook points here. Two paths:
//
//   A. CODE FALLBACK (no caller ID): the inbound body is a 6-digit code. We look
//      up the BUILDING demo_sessions row for that code, bind the sender's phone,
//      flip it to READY, and fire the missed-call text-back (fr_config.greeting)
//      to the sender. This is how a prospect whose caller ID is withheld still
//      gets the demo: "text CODE to this number first". Widened 4->6 digits + a
//      per-sender attempt throttle (H4) so the code space is not brute-forceable.
//
//   B. MULTI-TURN QUALIFY: any other inbound text continues the SMS conversation
//      using the per-session fr_config.system_prompt (the prospect's business
//      voice). Rate-limited two ways (C2): a per-sender daily reply cap and a
//      global daily outbound-SMS breaker, so an inbound flood can not run up
//      unbounded model + SMS spend.
//
// Telnyx inbound messages arrive as JSON (data.payload.from.phone_number, .text),
// NOT form-encoded. We reply by SENDING an SMS via the Messaging API (Telnyx does
// not use TeXML for inbound-message replies the way Twilio's Messages TwiML does),
// and return 200 to acknowledge the webhook.
import {
  adminClient,
  findBuildingByCode,
  findReadyByPhone,
  markTexted,
  loadConversation,
  upsertConversation,
} from "../_shared/db.ts"
import { sendSms } from "../_shared/telnyx.ts"
import { toE164, isPhoneCode } from "../_shared/normalize.ts"
import { verifyTelnyx } from "../_shared/verify.ts"
import { generateReply, type Msg } from "../_shared/portkey.ts"
import { bumpCounter } from "../_shared/counter.ts"

const BUSINESS = "fr_demo"
const HISTORY_TURNS = 10
const FALLBACK_REPLY = "Thanks! One of our team will follow up shortly."
const DEFAULT_GREETING = "Sorry we missed you. What can we help you with?"
// Said once when a per-sender cap is hit, then we go silent for that number.
const CAPPED_REPLY = "Thanks! Let's continue this with a real rep, someone will reach out."

// Env-overridable caps (read at call time; defaults are the source of truth).
function intEnv(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name))
  return Number.isFinite(n) && n > 0 ? n : fallback
}
// C2(a): max assistant replies per sender per day (the qualify loop).
const perSenderReplyCap = () => intEnv("DEMO_SMS_MAX_REPLIES_PER_NUMBER_PER_DAY", 20)
// C2(b): global outbound-SMS breaker for the day (mirrors the start route's daily cap).
const globalSmsCap = () => intEnv("DEMO_SMS_MAX_PER_DAY", 500)
// H4: max inbound code attempts per sender per day.
const codeAttemptCap = () => intEnv("DEMO_CODE_MAX_ATTEMPTS_PER_NUMBER_PER_DAY", 10)

interface Parsed {
  from: string | null
  text: string
}

/** Parse a Telnyx inbound-message webhook (JSON) OR a form-encoded TeXML post. */
function parseInbound(rawBody: string, contentType: string): Parsed {
  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(rawBody)
      const p = json?.data?.payload ?? json?.payload ?? {}
      const from = p?.from?.phone_number ?? p?.from ?? null
      const text = typeof p?.text === "string" ? p.text : ""
      return { from: typeof from === "string" ? from : null, text }
    } catch {
      return { from: null, text: "" }
    }
  }
  // Fallback: form-encoded (TeXML-style From/Body), useful for tests/manual posts.
  const form = new URLSearchParams(rawBody)
  return { from: form.get("From"), text: form.get("Body") ?? "" }
}

/**
 * Send an SMS only if the global daily outbound breaker allows it (C2(b)). The
 * breaker bump is atomic (the increment IS the gate). Returns the send result, or a
 * skipped result when the breaker is tripped so the caller stops. Best-effort: the
 * breaker is only consulted for assistant-generated replies, not for the one-time
 * canned cap message (that would defeat the "reply once then stop" contract, and it
 * is O(1) per number by construction).
 */
async function sendGuarded(
  supabase: ReturnType<typeof adminClient>,
  to: string,
  text: string
): Promise<boolean> {
  if (!(await bumpCounter(supabase, "sms_reply_global", "-", globalSmsCap()))) {
    return false // global breaker tripped; do not send
  }
  const sent = await sendSms(to, text)
  return sent.ok
}

export async function handler(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const okSig = await verifyTelnyx(
    rawBody,
    req.headers.get("telnyx-signature-ed25519"),
    req.headers.get("telnyx-timestamp")
  )
  if (!okSig) return new Response("invalid signature", { status: 401 })

  const { from: rawFrom, text: body } = parseInbound(
    rawBody,
    req.headers.get("content-type") ?? ""
  )
  const from = toE164(rawFrom ?? "")
  if (!from) return new Response("ok", { status: 200 })

  const supabase = adminClient()
  const trimmed = body.trim()

  // --- Path A: 6-digit code fallback (no-caller-ID binding). ---
  if (isPhoneCode(trimmed)) {
    // H4: throttle inbound code attempts per sender BEFORE any lookup, so the
    // 6-digit space can't be brute-forced and stray codes can't burn work. This
    // also caps the M4 wrong-code fall-through (a wrong code counts as an attempt).
    if (!(await bumpCounter(supabase, "code_attempt", from, codeAttemptCap()))) {
      // Too many attempts today: acknowledge without lookup, reply, or model call.
      return new Response("ok", { status: 200 })
    }

    const session = await findBuildingByCode(supabase, trimmed)
    if (session) {
      // Bind the sender's phone + flip to ready so a subsequent call also works,
      // then fire the text-back greeting to the sender now.
      const greeting = session.fr_config?.greeting ?? DEFAULT_GREETING
      await supabase
        .from("demo_sessions")
        .update({ phone: from, status: "ready" })
        .eq("id", session.id)

      if (await sendGuarded(supabase, from, greeting)) {
        await upsertConversation(
          supabase,
          from,
          BUSINESS,
          [{ role: "assistant", content: greeting }],
          0
        )
        await markTexted(supabase, session.id)
      }
      return new Response("ok", { status: 200 })
    }
    // Wrong/unknown code (M4): the attempt was already counted above. Do NOT fall
    // through to the qualify path (that would let a stray code burn a model call
    // outside the code-attempt throttle). Silently acknowledge.
    return new Response("ok", { status: 200 })
  }

  // --- Path B: multi-turn qualify using the per-session persona. ---
  const session = await findReadyByPhone(supabase, from)
  const systemPrompt = session?.fr_config?.system_prompt

  // No persona for this sender: acknowledge and stop (do not burn a model call).
  if (!systemPrompt) {
    // Still governed by the global breaker so an unknown-number flood can't spam.
    await sendGuarded(supabase, from, FALLBACK_REPLY)
    return new Response("ok", { status: 200 })
  }

  // Load conversation history + per-sender reply count for this sender.
  const convo = await loadConversation(supabase, from, BUSINESS)

  // C2(a): per-sender daily reply cap. Once crossed, say the canned line ONCE and
  // stop (no model call, no further replies for the rest of the day).
  const cap = perSenderReplyCap()
  if (convo.reply_count >= cap) {
    if (convo.reply_count === cap) {
      // Exactly at the cap: emit the single hand-off line, then bump past it so we
      // stay silent on subsequent texts. Governed by the global breaker.
      await sendGuarded(supabase, from, CAPPED_REPLY)
      await upsertConversation(supabase, from, BUSINESS, convo.messages, cap + 1)
    }
    return new Response("ok", { status: 200 })
  }

  const history = convo.messages as Msg[]
  const modelMessages: Msg[] = [
    ...history.slice(-HISTORY_TURNS),
    { role: "user", content: trimmed || "(no text)" },
  ]

  let reply = await generateReply(systemPrompt, modelMessages)
  if (!reply) reply = FALLBACK_REPLY

  const updated: Msg[] = [
    ...history,
    { role: "user", content: trimmed || "(no text)" },
    { role: "assistant", content: reply },
  ]

  // Send under the global breaker; only persist the incremented reply_count when
  // the send actually went out, so a breaker-blocked turn doesn't consume the cap.
  const sent = await sendGuarded(supabase, from, reply)
  await upsertConversation(
    supabase,
    from,
    BUSINESS,
    updated,
    sent ? convo.reply_count + 1 : convo.reply_count
  )
  return new Response("ok", { status: 200 })
}

Deno.serve(handler)
