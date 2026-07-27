// Deno-native thin Portkey client for the demo edge functions.
//
// The Next.js app has its own copy at src/lib/demo/portkey.ts; edge functions run
// on Deno and cannot import the app's src/, so this is the deliberate small mirror
// (same decision b: mate-onboarding calls Portkey directly, no shared package).
// OpenAI-compatible /v1/chat/completions, BYOK passthrough via x-portkey-provider
// + Authorization, per .claude/rules/portkey-gateway.md. Cheapest model that
// clears the bar for 1-2 sentence SMS replies (.claude/rules/model-agnostic.md).

const DEFAULT_PORTKEY_BASE_URL = "https://portkey.auto-mate.business"

// Cheap SMS-reply model (creator/model). google -> GEMINI_API_KEY as the BYOK key.
// Must be NON-reasoning: gemini-3-flash-preview burns the whole low max_tokens
// budget on reasoning tokens and returns EMPTY content, blanking the reply.
// gemini-2.5-flash is cheap, non-reasoning, and returns clean output.
const REPLY_MODEL = Deno.env.get("DEMO_REPLY_MODEL") ?? "google/gemini-2.5-flash"

// max_tokens floor for a 1-2 sentence SMS reply. Belt-and-suspenders against a
// model swap silently truncating to empty content.
const MIN_REPLY_MAX_TOKENS = 256

export interface Msg {
  role: "system" | "user" | "assistant"
  content: string
}

function providerKey(provider: string): string {
  switch (provider) {
    case "google":
      return Deno.env.get("GEMINI_API_KEY") ?? ""
    case "openai":
      return Deno.env.get("OPENAI_API_KEY") ?? ""
    case "anthropic":
      return Deno.env.get("ANTHROPIC_API_KEY") ?? ""
    default:
      return ""
  }
}

/**
 * Generate a First Responder SMS reply via Portkey. Never throws; returns "" so
 * the caller can fall back to a safe canned line. `system` is the per-session
 * fr_config.system_prompt (the prospect's business voice).
 */
export async function generateReply(system: string, msgs: Msg[]): Promise<string> {
  const slash = REPLY_MODEL.indexOf("/")
  const provider = slash === -1 ? "google" : REPLY_MODEL.slice(0, slash)
  const model = slash === -1 ? REPLY_MODEL : REPLY_MODEL.slice(slash + 1)
  const key = providerKey(provider)
  const base = Deno.env.get("PORTKEY_BASE_URL") ?? DEFAULT_PORTKEY_BASE_URL

  const messages: Msg[] = [{ role: "system", content: system }, ...msgs]

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "x-portkey-provider": provider,
        "x-portkey-metadata": JSON.stringify({ app: "mate-onboarding", surface: "fr-demo" }),
      },
      body: JSON.stringify({ model, messages, max_tokens: Math.max(300, MIN_REPLY_MAX_TOKENS) }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return ""
    const json = await res.json()
    return json?.choices?.[0]?.message?.content?.trim() ?? ""
  } catch {
    return ""
  }
}
