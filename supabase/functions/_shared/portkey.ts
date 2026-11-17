// Deno-native thin Portkey client for the demo edge functions.
//
// The Next.js app has its own copy at src/lib/demo/portkey.ts; edge functions run
// on Deno and cannot import the app's src/, so this is the deliberate small mirror
// (same decision b: mate-onboarding calls Portkey directly, no shared package).
// OpenAI-compatible /v1/chat/completions, BYOK passthrough via x-portkey-provider
// + Authorization, per .claude/rules/portkey-gateway.md. Cheapest model that
// clears the bar for 1-2 sentence SMS replies (.claude/rules/model-agnostic.md).

const DEFAULT_PORTKEY_BASE_URL = "https://portkey.auto-mate.business"

// Cheap SMS-reply model (creator/model). anthropic -> ANTHROPIC_API_KEY as the
// BYOK key. Moved from google/gemini-2.5-flash to Claude Haiku 5.5 on 2026-11-16
// (founder ruling: "move it all to claude"; same model as the app's reply class
// in src/lib/demo/portkey.ts). History: must be NON-reasoning, because
// gemini-3-flash-preview burned the whole low max_tokens budget on reasoning
// tokens and returned EMPTY content, blanking the reply. Haiku does not reason
// unless asked. DEMO_REPLY_MODEL still overrides; leave it unset in production.
const REPLY_MODEL = Deno.env.get("DEMO_REPLY_MODEL") ?? "anthropic/claude-haiku-5-5"

// max_tokens budget for a 1-2 sentence SMS reply. This must cover Gemini's HIDDEN
// reasoning tokens PLUS the visible content: gemini-2.5-flash emits ~100-300
// reasoning tokens even for a short reply, and a tight budget (e.g. 300) gets fully
// consumed by reasoning, leaving the visible SMS truncated mid-sentence
// (finish_reason:"length"). 800 leaves ample room for the visible text after
// reasoning (verified: finish_reason:"stop", full reply). We ALSO request
// reasoning_effort:"none" below to shrink the reasoning burn where the model honors
// it. Env-overridable so a cheaper/less-chatty model can lower it.
function replyMaxTokens(): number {
  const n = Number(Deno.env.get("DEMO_REPLY_MAX_TOKENS"))
  return Number.isFinite(n) && n >= 256 ? n : 800
}

export interface Msg {
  role: "system" | "user" | "assistant"
  content: string
}

// Env var holding each provider's BYOK key.
const KEY_ENV: Record<string, string> = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
}

// Retried once when Anthropic says the credit is spent; the same model and the
// same rule as the app (src/lib/demo/portkey.ts FALLBACK_MODEL / isCreditOut).
export const FALLBACK_MODEL = "openai/gpt-4o-mini"

// Anthropic reports exhausted credit as a 400 ("Your credit balance is too low
// to access the Anthropic API"); its billing_error type and a plain 402 mean
// the same. The one failure that falls back: a bad request, an outage or a
// missing key still ends in "" and the caller's canned line.
const CREDIT_EXHAUSTED = /credit balance is too low|"billing_error"/i

export function isCreditOut(status: number, body: string): boolean {
  return status === 402 || (status >= 400 && status < 500 && CREDIT_EXHAUSTED.test(body))
}

type Once = { ok: true; text: string } | { ok: false; creditOut: boolean }

async function replyOnce(modelId: string, system: string, msgs: Msg[]): Promise<Once> {
  const slash = modelId.indexOf("/")
  const provider = slash === -1 ? "google" : modelId.slice(0, slash)
  const model = slash === -1 ? modelId : modelId.slice(slash + 1)
  const envName = KEY_ENV[provider]
  const key = envName ? Deno.env.get(envName)?.trim() ?? "" : ""
  // Fail closed: never send an empty key upstream. The log names the
  // variable, never a value.
  if (!key) {
    console.error(`[portkey] ${envName ?? `no key for provider ${provider}`} is not set. Refusing this reply.`)
    return { ok: false, creditOut: false }
  }
  const base = Deno.env.get("PORTKEY_BASE_URL") ?? DEFAULT_PORTKEY_BASE_URL
  const gatewayKey = Deno.env.get("PORTKEY_GATEWAY_KEY")?.trim()

  const messages: Msg[] = [{ role: "system", content: system }, ...msgs]

  // Request no reasoning where the model honors it (cuts hidden-token burn +
  // latency). Gemini via this Portkey path accepted reasoning_effort:"none" (200);
  // a model that rejects the field is covered by the ample max_tokens budget above.
  // Sent to google only: it is a Gemini knob, and Claude needs none.
  const payload: Record<string, unknown> = {
    model,
    messages,
    max_tokens: replyMaxTokens(),
    ...(provider === "google" ? { reasoning_effort: "none" } : {}),
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "x-portkey-provider": provider,
      "x-portkey-metadata": JSON.stringify({ app: "mate-onboarding", surface: "fr-demo" }),
    }
    if (gatewayKey) headers["x-amos-gateway-key"] = gatewayKey

    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, creditOut: isCreditOut(res.status, body) }
    }
    const json = await res.json()
    return { ok: true, text: json?.choices?.[0]?.message?.content?.trim() ?? "" }
  } catch {
    return { ok: false, creditOut: false }
  }
}

/**
 * Generate a First Responder SMS reply via Portkey. Never throws; returns "" so
 * the caller can fall back to a safe canned line. `system` is the per-session
 * fr_config.system_prompt (the prospect's business voice). A spent Claude
 * credit retries once on FALLBACK_MODEL; nothing else does.
 */
export async function generateReply(system: string, msgs: Msg[]): Promise<string> {
  const first = await replyOnce(REPLY_MODEL, system, msgs)
  if (first.ok) return first.text
  if (!first.creditOut || REPLY_MODEL === FALLBACK_MODEL) return ""
  console.warn(`[portkey] ${REPLY_MODEL} is out of credit, falling back to ${FALLBACK_MODEL}`)
  const second = await replyOnce(FALLBACK_MODEL, system, msgs)
  return second.ok ? second.text : ""
}
