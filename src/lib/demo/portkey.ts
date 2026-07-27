// Thin, self-contained Portkey client for mate-onboarding.
//
// Decision (spec, option b): mate-onboarding calls the self-hosted Portkey OSS
// gateway DIRECTLY. It does NOT import amos-ui's model-gateway and does NOT share
// a package. This is an intentional small vendored copy that mirrors amos-ui's
// intent (per .claude/rules/portkey-gateway.md): OpenAI-compatible
// /v1/chat/completions, BYOK passthrough (Portkey stores no keys — each request
// declares its upstream provider via x-portkey-provider and carries that
// provider's key in Authorization), and x-portkey-metadata for cost attribution.
// A shared-brain refactor is a separate future task, deliberately not attempted
// here.
//
// Model choice = cheapest that clears the bar (.claude/rules/model-agnostic.md):
// scrape->profile extraction and 1-2 sentence SMS qualify replies are both small
// tasks, so both task classes map to a cheap Gemini Flash tier.
//
// IMPORTANT: use a NON-reasoning model here. gemini-3-flash-preview is a reasoning
// model — at the low max_tokens these small tasks use, it spends the whole output
// budget on reasoning tokens and returns EMPTY content (finish_reason:"length",
// completion_tokens:0). That silently broke extraction (every persona fell back to
// "this business") and would blank the SMS replies. gemini-2.5-flash is a cheap
// non-reasoning model on the same GEMINI_API_KEY and returns clean output.
//
// SPOF mitigation: LLM_PORTKEY_BYPASS=1 routes provider-native (skip the gateway),
// mirroring amos-ui's bypass flag for a KVM2 outage.

const DEFAULT_PORTKEY_BASE_URL = "https://portkey.auto-mate.business"

type Provider = "google" | "openai" | "anthropic"

// Local task-class -> model map. Ids are `creator/model`; `creator` is the
// Portkey provider, the part after the first "/" is the bare model forwarded
// upstream. Kept intentionally tiny (two classes) — this app only needs cheap
// extraction and cheap SMS replies.
export const TASK_MODELS = {
  // scrape -> company profile extraction (classify/extract): cheap, non-reasoning.
  extract: "google/gemini-2.5-flash",
  // First Responder SMS reply (light reasoning, 1-2 sentences): cheap, non-reasoning.
  reply: "google/gemini-2.5-flash",
} as const

export type TaskClass = keyof typeof TASK_MODELS

// max_tokens floors per task class. Belt-and-suspenders: a model swap (or a
// caller passing too small a budget) must never silently truncate to empty
// content. Extraction returns a multi-field JSON object (needs room); an SMS
// reply is 1-2 sentences. A caller's maxTokens is clamped UP to these floors.
export const MIN_MAX_TOKENS: Record<TaskClass, number> = {
  extract: 1024,
  reply: 256,
}

export function modelForClass(cls: TaskClass): string {
  return TASK_MODELS[cls]
}

function portkeyBaseUrl(): string {
  return process.env.PORTKEY_BASE_URL ?? DEFAULT_PORTKEY_BASE_URL
}

function parseModelId(modelId: string): { provider: Provider; model: string } {
  const slash = modelId.indexOf("/")
  const creator = slash === -1 ? "" : modelId.slice(0, slash)
  const model = slash === -1 ? modelId : modelId.slice(slash + 1)
  if (creator !== "google" && creator !== "openai" && creator !== "anthropic") {
    throw new Error(`portkey: unknown provider "${creator}" in "${modelId}"`)
  }
  return { provider: creator, model }
}

function providerKey(provider: Provider): string {
  switch (provider) {
    case "google":
      return process.env.GEMINI_API_KEY ?? ""
    case "openai":
      return process.env.OPENAI_API_KEY ?? ""
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ?? ""
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatCompleteOpts {
  taskClass: TaskClass
  messages: ChatMessage[]
  system?: string
  maxTokens?: number
}

/**
 * Run a chat completion through Portkey (or provider-native when bypassed).
 *
 * NEVER throws on a model/network failure — returns "" so the caller can fall
 * back (the demo funnel must keep flowing). Only a misconfigured model id (unknown
 * provider) throws, and that is a programming error, not a runtime condition.
 */
export async function chatComplete(opts: ChatCompleteOpts): Promise<string> {
  const modelId = modelForClass(opts.taskClass)
  const { provider, model } = parseModelId(modelId)
  const key = providerKey(provider)

  const messages: ChatMessage[] = opts.system
    ? [{ role: "system", content: opts.system }, ...opts.messages]
    : opts.messages

  // Clamp UP to the per-task floor so an under-budgeted call can't truncate to
  // empty content (the exact failure a reasoning model produced here).
  const floor = MIN_MAX_TOKENS[opts.taskClass]
  const maxTokens = Math.max(opts.maxTokens ?? floor, floor)

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
  })

  const bypass = process.env.LLM_PORTKEY_BYPASS === "1"

  // Bypass -> provider-native OpenAI-compatible endpoint. Only OpenAI exposes a
  // drop-in /v1/chat/completions natively; Google/Anthropic do not, so the bypass
  // is only meaningful for openai upstreams. For google (our default) the bypass
  // still targets Portkey's URL unless PORTKEY_BASE_URL is repointed, so in
  // practice the KVM2-outage failover for THIS app is: flip TASK_MODELS to an
  // openai model AND set LLM_PORTKEY_BYPASS=1, or repoint PORTKEY_BASE_URL. Kept
  // simple on purpose — documented in the go-live notes.
  const baseUrl = bypass && provider === "openai" ? "https://api.openai.com" : portkeyBaseUrl()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  }
  if (!(bypass && provider === "openai")) {
    headers["x-portkey-provider"] = provider
    headers["x-portkey-metadata"] = JSON.stringify({ app: "mate-onboarding" })
  }

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return ""
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return json?.choices?.[0]?.message?.content?.trim() ?? ""
  } catch {
    return ""
  }
}
