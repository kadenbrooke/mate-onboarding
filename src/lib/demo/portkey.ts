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
//
// Per-tenant keys: every entry point takes the AUTHORIZED session id and the
// google key comes from resolveGeminiKey (./geminiKey). null = no tenant (the
// prospect demo funnel), which uses the shared GEMINI_API_KEY. Routing through
// Portkey is unchanged; only the Authorization key differs.

import { resolveGeminiKey } from "./geminiKey"

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
  // Dashboard assistant chat: longer answers about the client's data. Cheap,
  // non-reasoning (same reasoning-model empty-output trap applies).
  assistant: "google/gemini-2.5-flash",
  // Lead Snapshot: read a photographed note into lead fields. This is the
  // `long-doc-vision` class from amos's .claude/model-routing/registry.json,
  // pinned by the Lead Snapshot spec. piiSafe: true is BINDING here, because a
  // client's handwritten note has a real person's name, phone, and address in
  // frame. Never point this at an OpenRouter-backed row.
  vision: "google/gemini-3.6-flash",
} as const

export type TaskClass = keyof typeof TASK_MODELS

// max_tokens floors per task class. Belt-and-suspenders: a model swap (or a
// caller passing too small a budget) must never silently truncate to empty
// content. Extraction returns a multi-field JSON object (needs room); an SMS
// reply is 1-2 sentences. A caller's maxTokens is clamped UP to these floors.
export const MIN_MAX_TOKENS: Record<TaskClass, number> = {
  extract: 1024,
  reply: 256,
  assistant: 1500,
  // Generous on purpose. A multi-lead photo returns an array of objects, and
  // the empty-output trap in the header note bites hardest when the budget is
  // tight. 2500 matches what amos-ui gives its own image ingest.
  vision: 2500,
}

export function modelForClass(cls: TaskClass): string {
  return TASK_MODELS[cls]
}

function portkeyBaseUrl(): string {
  return process.env.PORTKEY_BASE_URL ?? DEFAULT_PORTKEY_BASE_URL
}

function portkeyGatewayKeyHeader(): Record<string, string> {
  const key = process.env.PORTKEY_GATEWAY_KEY?.trim()
  return key ? { "x-amos-gateway-key": key } : {}
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

type ProviderKey = { ok: true; key: string } | { ok: false; detail: string }

function providerKey(provider: Provider, sessionId: string | null): ProviderKey {
  switch (provider) {
    case "google": {
      const g = resolveGeminiKey(sessionId)
      return g.ok ? { ok: true, key: g.key } : { ok: false, detail: `${g.envName} is not set` }
    }
    case "openai":
      return { ok: true, key: process.env.OPENAI_API_KEY ?? "" }
    case "anthropic":
      return { ok: true, key: process.env.ANTHROPIC_API_KEY ?? "" }
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
  /** Authorized tenant session (picks the Gemini key); null = no tenant, shared key. */
  sessionId: string | null
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
  const resolved = providerKey(provider, opts.sessionId)
  // Fail closed: a tenant whose own key is missing gets the same "" as any
  // other failure, never a call on the shared key (geminiKey logs the name).
  if (!resolved.ok) return ""
  const key = resolved.key

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
    Object.assign(headers, portkeyGatewayKeyHeader())
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

export interface ChatStreamOpts {
  messages: ChatMessage[]
  system?: string
  maxTokens?: number
  taskClass?: TaskClass
  /** Authorized tenant session (picks the Gemini key); null = no tenant, shared key. */
  sessionId: string | null
}

/**
 * Start a STREAMING chat completion through Portkey. Returns the raw fetch
 * Response so the caller can pipe/parse the SSE body. Throws only on a
 * misconfigured model id; network/HTTP errors surface via res.ok / res.body
 * for the caller to handle. Mirrors chatComplete's provider/bypass logic.
 */
export async function portkeyChatStream(opts: ChatStreamOpts): Promise<Response> {
  const cls = opts.taskClass ?? "assistant"
  const { provider, model } = parseModelId(modelForClass(cls))
  const resolved = providerKey(provider, opts.sessionId)
  // Fail closed as a plain non-ok Response, so the caller's existing !res.ok
  // path answers "unavailable" and nothing goes upstream on the shared key.
  if (!resolved.ok) return new Response(null, { status: 503, statusText: resolved.detail })
  const key = resolved.key

  const messages: ChatMessage[] = opts.system
    ? [{ role: "system", content: opts.system }, ...opts.messages]
    : opts.messages

  const floor = MIN_MAX_TOKENS[cls]
  const maxTokens = Math.max(opts.maxTokens ?? floor, floor)

  const bypass = process.env.LLM_PORTKEY_BYPASS === "1"
  const baseUrl = bypass && provider === "openai" ? "https://api.openai.com" : portkeyBaseUrl()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  }
  if (!(bypass && provider === "openai")) {
    headers["x-portkey-provider"] = provider
    headers["x-portkey-metadata"] = JSON.stringify({ app: "mate-onboarding", surface: "assistant" })
    Object.assign(headers, portkeyGatewayKeyHeader())
  }

  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
    signal: AbortSignal.timeout(60000),
  })
}

// ---------------------------------------------------------------------------
// Vision (Lead Snapshot)
// ---------------------------------------------------------------------------

export interface VisionImage {
  /** Sniffed mime, never the client's declared content-type. */
  mime: string
  /** Raw image bytes. Base64 encoding happens here, once. */
  bytes: Uint8Array
}

export type VisionResult =
  | { ok: true; text: string }
  | { ok: false; kind: "config" | "http" | "network" | "empty"; detail: string }

/**
 * Fallback for the vision class when the primary provider is unavailable.
 *
 * Added 2026-09-11 after the Gemini key returned 429 RESOURCE_EXHAUSTED
 * (prepay credits depleted) and took the reader down with it. A depleted or
 * rate-limited provider is a billing event, not a reason for a client to get
 * "could not read that photo". OpenAI is already a configured provider on the
 * gateway with a working key, and this model does vision cheaply. piiSafe
 * holds: it is OpenAI direct, not an OpenRouter-backed row.
 *
 * Only PROVIDER failures fall through (429, 5xx, transport). A 4xx that says
 * the request itself is bad, or a clean-but-empty answer, is returned as is,
 * because retrying the same bad request on another model hides the bug.
 */
export const VISION_FALLBACK_MODEL = "openai/gpt-4o-mini"

function shouldFallBack(r: VisionResult): boolean {
  if (r.ok) return false
  if (r.kind === "network") return true
  if (r.kind !== "http") return false
  const status = Number(r.detail.slice(0, 3))
  return status === 429 || status >= 500
}

/**
 * Run a vision completion through Portkey.
 *
 * Unlike chatComplete, this reports WHY it failed instead of collapsing every
 * failure to "". The Lead Snapshot route needs the difference: a gateway
 * outage should tell the client "try again in a minute", while an unreadable
 * photo should tell them "retake it". Silently returning "" would render both
 * as the same shrug, and the 429 that the depleted Gemini credits produce
 * would look identical to a blurry photo.
 *
 * Tries the vision class model first, then VISION_FALLBACK_MODEL when the
 * primary provider itself is down (see shouldFallBack).
 */
export async function visionComplete(opts: {
  prompt: string
  images: VisionImage[]
  system?: string
  maxTokens?: number
  clientId?: string
  /** Authorized tenant session (picks the Gemini key); null = no tenant, shared key. */
  sessionId: string | null
}): Promise<VisionResult & { model?: string }> {
  if (opts.images.length === 0) {
    return { ok: false, kind: "config", detail: "no images supplied" }
  }
  const primary = await visionOnce(modelForClass("vision"), opts)
  if (!shouldFallBack(primary)) return { ...primary, model: modelForClass("vision") }

  console.warn("vision: primary failed, falling back", primary.ok ? "" : `${primary.kind} ${primary.detail.slice(0, 120)}`)
  const second = await visionOnce(VISION_FALLBACK_MODEL, opts)
  return { ...second, model: VISION_FALLBACK_MODEL }
}

async function visionOnce(
  modelId: string,
  opts: {
    prompt: string
    images: VisionImage[]
    system?: string
    maxTokens?: number
    clientId?: string
    sessionId: string | null
  },
): Promise<VisionResult> {
  let provider: Provider
  let model: string
  try {
    ({ provider, model } = parseModelId(modelId))
  } catch (e) {
    return { ok: false, kind: "config", detail: e instanceof Error ? e.message : String(e) }
  }

  // A tenant missing its own key is a "config" failure, which shouldFallBack
  // never retries on another provider: fail closed, nothing is sent.
  const resolved = providerKey(provider, opts.sessionId)
  if (!resolved.ok) return { ok: false, kind: "config", detail: resolved.detail }
  const key = resolved.key
  if (!key) return { ok: false, kind: "config", detail: `no API key for provider ${provider}` }

  const floor = MIN_MAX_TOKENS.vision
  const maxTokens = Math.max(opts.maxTokens ?? floor, floor)

  const content: Record<string, unknown>[] = [{ type: "text", text: opts.prompt }]
  for (const img of opts.images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${Buffer.from(img.bytes).toString("base64")}` },
    })
  }

  const messages: Record<string, unknown>[] = opts.system
    ? [{ role: "system", content: opts.system }, { role: "user", content }]
    : [{ role: "user", content }]

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    "x-portkey-provider": provider,
    "x-portkey-metadata": JSON.stringify({
      app: "mate-onboarding",
      surface: "lead-snapshot",
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
    }),
  }
  Object.assign(headers, portkeyGatewayKeyHeader())

  let res: Response
  try {
    res = await fetch(`${portkeyBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      // Longer than the text paths: a multi-megabyte image upload plus a
      // multi-lead extraction is not a 15 second job.
      signal: AbortSignal.timeout(60000),
    })
  } catch (e) {
    return { ok: false, kind: "network", detail: e instanceof Error ? e.message : String(e) }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return { ok: false, kind: "http", detail: `${res.status} ${body.slice(0, 300)}` }
  }

  let json: { choices?: { message?: { content?: string } }[] }
  try {
    json = (await res.json()) as typeof json
  } catch (e) {
    return { ok: false, kind: "http", detail: `unparseable response: ${e instanceof Error ? e.message : String(e)}` }
  }

  const text = json?.choices?.[0]?.message?.content?.trim() ?? ""
  // The reasoning-model trap from the header note: a model that spends its
  // whole budget on reasoning returns 200 with empty content. Name it rather
  // than letting it read as an unreadable photo.
  if (!text) return { ok: false, kind: "empty", detail: "model returned empty content" }

  return { ok: true, text }
}
