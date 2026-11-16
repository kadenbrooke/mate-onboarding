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
// tasks, so both task classes map to a cheap tier.
//
// Every class runs on Claude since 2026-11-16 (founder ruling: "move it all to
// claude"), paid from the Max plan's API credit through ANTHROPIC_API_KEY:
// Haiku 5.5 for extraction and SMS replies, Sonnet 5.5 for the assistant and
// for reading photos. The Gemini notes below are history, kept because the
// google provider and its per-tenant key guard remain in place.
//
// IMPORTANT: watch hidden reasoning tokens. gemini-3-flash-preview is a reasoning
// model: at the low max_tokens these small tasks used, it spent the whole output
// budget on reasoning tokens and returned EMPTY content (finish_reason:"length",
// completion_tokens:0). That silently broke extraction (every persona fell back to
// "this business") and would blank the SMS replies.
//
// extract + assistant moved from gemini-2.5-flash to gemini-3.6-flash on
// 2026-10-22: Google closed 2.5 Flash to new AI Studio projects (a client's own
// key, e.g. GEMINI_API_KEY_CARSON, is refused it) and it is retiring. 3.6 Flash
// also reasons (300-800 hidden tokens per answer at its default effort), so
// TASK_PARAMS asks for reasoning_effort "minimal" (measured 0 reasoning tokens,
// same extraction scores as 2.5, faster) and the floors below leave room for a
// full-effort answer in case a gateway or model ignores that field.
//
// SPOF mitigation: LLM_PORTKEY_BYPASS=1 routes provider-native (skip the gateway),
// mirroring amos-ui's bypass flag for a KVM2 outage.
//
// Per-tenant keys: every entry point takes the AUTHORIZED session id and the
// google key comes from resolveGeminiKey (./geminiKey). null = no tenant (the
// prospect demo funnel), which uses the shared GEMINI_API_KEY. Routing through
// Portkey is unchanged; only the Authorization key differs.
//
// Per-tenant models: the same session id can also pick a different model per
// class (./tenantModels). Claude goes over Portkey's OpenAI-compatible chat
// path like every other call here; that path translates text, streaming and
// image_url parts for Anthropic.
//
// Credit-out fallback: when Anthropic says the credit is spent, every class
// retries once on OpenAI (FALLBACK_MODEL), so a spent credit never turns into
// silent empty answers. Only that billing answer triggers it on the text
// classes; see isCreditOut.

import { resolveGeminiKey } from "./geminiKey"
import { tenantModelFor } from "./tenantModels"

const DEFAULT_PORTKEY_BASE_URL = "https://portkey.auto-mate.business"

type Provider = "google" | "openai" | "anthropic"

// Local task-class -> model map. Ids are `creator/model`; `creator` is the
// Portkey provider, the part after the first "/" is the bare model forwarded
// upstream. Kept intentionally tiny (two classes) — this app only needs cheap
// extraction and cheap SMS replies.
export const TASK_MODELS = {
  // scrape -> company profile + call-note extraction (classify/extract): cheap.
  extract: "anthropic/claude-haiku-5-5",
  // First Responder SMS reply (light reasoning, 1-2 sentences): cheap.
  reply: "anthropic/claude-haiku-5-5",
  // Dashboard assistant chat: longer answers about the client's data.
  assistant: "anthropic/claude-sonnet-5-5",
  // Onboarding chat (/api/mate): a multi-turn conversation that calls tools to
  // save what the client tells it. Through the AI SDK (./portkeyModel).
  onboarding: "anthropic/claude-sonnet-5-5",
  // Lead Snapshot: read a photographed note into lead fields. This is the
  // `long-doc-vision` class from amos's .claude/model-routing/registry.json,
  // pinned by the Lead Snapshot spec. piiSafe: true is BINDING here, because a
  // client's handwritten note has a real person's name, phone, and address in
  // frame. Never point this at an OpenRouter-backed row.
  vision: "anthropic/claude-sonnet-5-5",
} as const

export type TaskClass = keyof typeof TASK_MODELS

// Extra request params per task class, sent on every GOOGLE chat call for that
// class (see paramsFor). reasoning_effort "minimal" is Gemini 3.x's lowest
// level over the OpenAI-compatible API ("none" is ignored by 3.6 Flash).
// Temperature is deliberately left at the model default: Google advises against
// lowering it on Gemini 3. Revisit these when a class moves to another model or
// provider.
export const TASK_PARAMS: Partial<Record<TaskClass, Record<string, unknown>>> = {
  extract: { reasoning_effort: "minimal" },
  assistant: { reasoning_effort: "minimal" },
}

// max_tokens floors per task class. Belt-and-suspenders: a model swap (or a
// caller passing too small a budget) must never silently truncate to empty
// content. Extraction returns a multi-field JSON object (needs room); an SMS
// reply is 1-2 sentences. A caller's maxTokens is clamped UP to these floors.
export const MIN_MAX_TOKENS: Record<TaskClass, number> = {
  // Room for a full-effort 3.6 Flash answer (up to ~800 reasoning tokens
  // measured) plus the JSON, if minimal effort is ever not honored.
  extract: 2048,
  reply: 256,
  // Same headroom over a multi-paragraph answer.
  assistant: 2500,
  // A short chat turn plus tool calls, per step.
  onboarding: 1500,
  // Generous on purpose. A multi-lead photo returns an array of objects, and
  // the empty-output trap in the header note bites hardest when the budget is
  // tight. 2500 matches what amos-ui gives its own image ingest.
  vision: 2500,
}

export function modelForClass(cls: TaskClass): string {
  return TASK_MODELS[cls]
}

/** The model a class runs on for this (authorized) session: its tenant override, else TASK_MODELS. */
export function modelFor(cls: TaskClass, sessionId: string | null): string {
  return tenantModelFor(sessionId, cls) ?? modelForClass(cls)
}

// TASK_PARAMS are Gemini knobs. Claude (Haiku/Sonnet 5.5) answers these small
// tasks without hidden reasoning unless asked, so it gets none of them.
function paramsFor(cls: TaskClass, provider: Provider): Record<string, unknown> {
  return provider === "google" ? (TASK_PARAMS[cls] ?? {}) : {}
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
    case "anthropic": {
      // Only tenants routed to Claude reach this, so a missing key refuses
      // (names the variable, never a value) instead of sending an empty one.
      const key = process.env.ANTHROPIC_API_KEY?.trim() ?? ""
      if (key) return { ok: true, key }
      console.error("[portkey] ANTHROPIC_API_KEY is not set. Refusing this Claude call.")
      return { ok: false, detail: "ANTHROPIC_API_KEY is not set" }
    }
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
  /** Authorized tenant session (picks the model and key); null = no tenant, shared key. */
  sessionId: string | null
}

/**
 * OpenAI model every class retries on when Anthropic says the credit is spent
 * (isCreditOut). gpt-4o-mini reads text and images cheaply, and it is OpenAI
 * direct, not an OpenRouter-backed row, so piiSafe holds for client data.
 */
export const FALLBACK_MODEL = "openai/gpt-4o-mini"

// Anthropic reports exhausted credit as a 400 ("Your credit balance is too low
// to access the Anthropic API"); its billing_error type and a plain 402 mean
// the same. A billing event, not a bad request, so it is the one failure the
// text classes fall back on. Everything else (a bad request, an outage, a
// missing key) behaves exactly as it did before the fallback existed.
const CREDIT_EXHAUSTED = /credit balance is too low|"billing_error"/i

export function isCreditOut(status: number, body: string): boolean {
  return status === 402 || (status >= 400 && status < 500 && CREDIT_EXHAUSTED.test(body))
}

/** Everything needed to call one model through the gateway (or the bypass). */
export type PortkeyConnection =
  | {
      ok: true
      provider: Provider
      /** Bare model id forwarded upstream (creator/ prefix stripped). */
      model: string
      /** Base URL that ends in /v1 (OpenAI-compatible). */
      baseURL: string
      /** The provider key, sent as Authorization: Bearer. */
      apiKey: string
      /** Gateway headers (none on the native bypass). */
      headers: Record<string, string>
    }
  | { ok: false; detail: string }

/**
 * Resolve a `creator/model` id for an authorized session into a gateway
 * connection, or refuse when its key is missing. Shared by the raw fetch paths
 * here and the AI SDK model in ./portkeyModel, so both route and fail closed
 * the same way.
 */
export function portkeyConnection(modelId: string, sessionId: string | null, surface?: string): PortkeyConnection {
  const { provider, model } = parseModelId(modelId)
  const resolved = providerKey(provider, sessionId)
  if (!resolved.ok) return resolved

  const bypass = process.env.LLM_PORTKEY_BYPASS === "1"

  // Bypass -> provider-native OpenAI-compatible endpoint. Only OpenAI exposes a
  // drop-in /v1/chat/completions natively; Google/Anthropic do not, so the bypass
  // is only meaningful for openai upstreams. For google (our default) the bypass
  // still targets Portkey's URL unless PORTKEY_BASE_URL is repointed, so in
  // practice the KVM2-outage failover for THIS app is: flip TASK_MODELS to an
  // openai model AND set LLM_PORTKEY_BYPASS=1, or repoint PORTKEY_BASE_URL. Kept
  // simple on purpose — documented in the go-live notes.
  const native = bypass && provider === "openai"
  const baseUrl = native ? "https://api.openai.com" : portkeyBaseUrl()

  const headers: Record<string, string> = {}
  if (!native) {
    headers["x-portkey-provider"] = provider
    headers["x-portkey-metadata"] = JSON.stringify(
      surface ? { app: "mate-onboarding", surface } : { app: "mate-onboarding" },
    )
    Object.assign(headers, portkeyGatewayKeyHeader())
  }
  return { ok: true, provider, model, baseURL: `${baseUrl}/v1`, apiKey: resolved.key, headers }
}

type Prepared =
  | { ok: true; provider: Provider; url: string; init: RequestInit }
  | { ok: false; detail: string }

/** Build one chat request for a model, or refuse when its key is missing. */
function prepareChat(
  modelId: string,
  cls: TaskClass,
  opts: { messages: ChatMessage[]; system?: string; maxTokens?: number; sessionId: string | null },
  extra: { stream: boolean; surface?: string; timeoutMs: number },
): Prepared {
  const conn = portkeyConnection(modelId, opts.sessionId, extra.surface)
  if (!conn.ok) return conn

  const messages: ChatMessage[] = opts.system
    ? [{ role: "system", content: opts.system }, ...opts.messages]
    : opts.messages

  // Clamp UP to the per-task floor so an under-budgeted call can't truncate to
  // empty content (the exact failure a reasoning model produced here).
  const floor = MIN_MAX_TOKENS[cls]
  const maxTokens = Math.max(opts.maxTokens ?? floor, floor)

  return {
    ok: true,
    provider: conn.provider,
    url: `${conn.baseURL}/chat/completions`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.apiKey}`, ...conn.headers },
      body: JSON.stringify({
        model: conn.model,
        messages,
        max_tokens: maxTokens,
        ...paramsFor(cls, conn.provider),
        ...(extra.stream ? { stream: true } : {}),
      }),
      signal: AbortSignal.timeout(extra.timeoutMs),
    },
  }
}

type CompleteOnce = { ok: true; text: string } | { ok: false; creditOut: boolean }

async function completeOnce(modelId: string, opts: ChatCompleteOpts): Promise<CompleteOnce> {
  const req = prepareChat(modelId, opts.taskClass, opts, { stream: false, timeoutMs: 15000 })
  // Fail closed: a tenant whose own key is missing gets the same "" as any
  // other failure, never a call on another key (providerKey logs the name).
  if (!req.ok) return { ok: false, creditOut: false }
  try {
    const res = await fetch(req.url, req.init)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, creditOut: isCreditOut(res.status, body) }
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return { ok: true, text: json?.choices?.[0]?.message?.content?.trim() ?? "" }
  } catch {
    return { ok: false, creditOut: false }
  }
}

/**
 * Run a chat completion through Portkey (or provider-native when bypassed).
 *
 * NEVER throws on a model/network failure — returns "" so the caller can fall
 * back (the demo funnel must keep flowing). Only a misconfigured model id (unknown
 * provider) throws, and that is a programming error, not a runtime condition.
 * A spent Claude credit retries once on FALLBACK_MODEL; nothing else does.
 */
export async function chatComplete(opts: ChatCompleteOpts): Promise<string> {
  const primary = modelFor(opts.taskClass, opts.sessionId)
  const first = await completeOnce(primary, opts)
  if (first.ok) return first.text
  if (!first.creditOut || primary === FALLBACK_MODEL) return ""
  console.warn(`[portkey] ${primary} is out of credit, falling back to ${FALLBACK_MODEL}`)
  const second = await completeOnce(FALLBACK_MODEL, opts)
  return second.ok ? second.text : ""
}

export interface ChatStreamOpts {
  messages: ChatMessage[]
  system?: string
  maxTokens?: number
  taskClass?: TaskClass
  /** Authorized tenant session (picks the model and key); null = no tenant, shared key. */
  sessionId: string | null
}

function streamOnce(modelId: string, cls: TaskClass, opts: ChatStreamOpts): Promise<Response> {
  const req = prepareChat(modelId, cls, opts, { stream: true, surface: "assistant", timeoutMs: 60000 })
  // Fail closed as a plain non-ok Response, so the caller's existing !res.ok
  // path answers "unavailable" and nothing goes upstream on another key.
  if (!req.ok) return Promise.resolve(new Response(null, { status: 503, statusText: req.detail }))
  return fetch(req.url, req.init)
}

/**
 * Start a STREAMING chat completion through Portkey. Returns the raw fetch
 * Response so the caller can pipe/parse the SSE body. Throws only on a
 * misconfigured model id; network/HTTP errors surface via res.ok / res.body
 * for the caller to handle. Mirrors chatComplete's provider/bypass logic,
 * including the one retry on FALLBACK_MODEL when the Claude credit is spent
 * (OpenAI streams the same SSE shape, so the caller's parser is unchanged).
 */
export async function portkeyChatStream(opts: ChatStreamOpts): Promise<Response> {
  const cls = opts.taskClass ?? "assistant"
  const primary = modelFor(cls, opts.sessionId)
  const res = await streamOnce(primary, cls, opts)
  if (res.ok || primary === FALLBACK_MODEL) return res
  const body = await res.clone().text().catch(() => "")
  if (!isCreditOut(res.status, body)) return res
  console.warn(`[portkey] ${primary} is out of credit, falling back to ${FALLBACK_MODEL}`)
  return streamOnce(FALLBACK_MODEL, cls, opts)
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
 * Since 2026-11-16 only a spent credit falls through, by the same isCreditOut
 * predicate the text classes use: a client photo goes to a second provider
 * only for the billing event this fallback exists for. A 429, a 5xx, a
 * transport error, a bad request, or a clean-but-empty answer is returned as
 * is, and the route tells the client to try again (or retake the photo).
 */
export const VISION_FALLBACK_MODEL = FALLBACK_MODEL

function shouldFallBack(r: VisionResult): boolean {
  if (r.ok || r.kind !== "http") return false
  return isCreditOut(Number(r.detail.slice(0, 3)), r.detail)
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
 * Tries the session's vision model first (modelFor), then
 * VISION_FALLBACK_MODEL when the Claude credit is spent (see shouldFallBack).
 */
export async function visionComplete(opts: {
  prompt: string
  images: VisionImage[]
  system?: string
  maxTokens?: number
  clientId?: string
  /** Authorized tenant session (picks the model and key); null = no tenant, shared key. */
  sessionId: string | null
}): Promise<VisionResult & { model?: string }> {
  if (opts.images.length === 0) {
    return { ok: false, kind: "config", detail: "no images supplied" }
  }
  const primaryModel = modelFor("vision", opts.sessionId)
  const primary = await visionOnce(primaryModel, opts)
  if (!shouldFallBack(primary) || primaryModel === VISION_FALLBACK_MODEL) return { ...primary, model: primaryModel }

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
