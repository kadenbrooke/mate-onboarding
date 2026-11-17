// AI SDK language model over the same Portkey gateway as ./portkey.
//
// For callers that need the AI SDK itself (streamText with tools, as the
// onboarding chat in /api/mate does) rather than the thin fetch client. The
// model id, key, gateway headers and fail-closed refusal all come from
// portkeyConnection, so a class routes here exactly as it does in ./portkey.
// The OpenAI provider package speaks the gateway's OpenAI-compatible
// /v1/chat/completions; the gateway translates to Anthropic.
//
// Credit-out fallback: when the primary call fails because the Claude credit
// is spent (isCreditOut), the same request is retried once on FALLBACK_MODEL.
// The check runs when the request is made, before any text has streamed, so
// the caller never sees half an answer from one model and the rest from
// another. Any other error is rethrown untouched.

import { createOpenAI } from "@ai-sdk/openai"
import { APICallError, wrapLanguageModel, type LanguageModelV1 } from "ai"
import { FALLBACK_MODEL, MIN_MAX_TOKENS, isCreditOut, modelFor, portkeyConnection, type TaskClass } from "./portkey"

export type PortkeyModel =
  | { ok: true; model: LanguageModelV1; modelId: string; maxTokens: number }
  | { ok: false; detail: string }

function connect(modelId: string, sessionId: string | null, surface?: string) {
  const conn = portkeyConnection(modelId, sessionId, surface)
  if (!conn.ok) return conn
  const provider = createOpenAI({
    baseURL: conn.baseURL,
    apiKey: conn.apiKey,
    headers: conn.headers,
    // The gateway is OpenAI-compatible, not OpenAI: no OpenAI-only fields.
    compatibility: "compatible",
    name: `portkey.${conn.provider}`,
  })
  const model = provider.chat(conn.model)
  if (conn.provider !== "anthropic") return { ok: true as const, model }
  // The AI SDK sends temperature 0 when the caller sets none, and Claude 5.5
  // answers 400 "`temperature` is deprecated for this model". Leave it unset so
  // Claude runs at its own default, the same as the fetch paths in ./portkey.
  return {
    ok: true as const,
    model: wrapLanguageModel({
      model,
      middleware: { transformParams: async ({ params }) => ({ ...params, temperature: undefined }) },
    }),
  }
}

function creditOut(e: unknown): boolean {
  return APICallError.isInstance(e) && isCreditOut(e.statusCode ?? 0, e.responseBody ?? "")
}

/**
 * The AI SDK model for a class and an AUTHORIZED session (null = no tenant),
 * plus the class's max_tokens floor, which Anthropic requires on every call.
 * Refuses (ok: false, names the missing variable) instead of sending an empty key.
 */
export function portkeyLanguageModel(cls: TaskClass, sessionId: string | null, surface?: string): PortkeyModel {
  const modelId = modelFor(cls, sessionId)
  const primary = connect(modelId, sessionId, surface)
  if (!primary.ok) return primary
  const maxTokens = MIN_MAX_TOKENS[cls]
  if (modelId === FALLBACK_MODEL) return { ok: true, model: primary.model, modelId, maxTokens }

  const fallback = () => {
    console.warn(`[portkey] ${modelId} is out of credit, falling back to ${FALLBACK_MODEL}`)
    const fb = connect(FALLBACK_MODEL, sessionId, surface)
    if (!fb.ok) throw new Error(fb.detail)
    return fb.model
  }

  const model = wrapLanguageModel({
    model: primary.model,
    middleware: {
      wrapGenerate: async ({ doGenerate, params }) => {
        try {
          return await doGenerate()
        } catch (e) {
          if (!creditOut(e)) throw e
          return fallback().doGenerate(params)
        }
      },
      wrapStream: async ({ doStream, params }) => {
        try {
          return await doStream()
        } catch (e) {
          if (!creditOut(e)) throw e
          return fallback().doStream(params)
        }
      },
    },
  })
  return { ok: true, model, modelId, maxTokens }
}
