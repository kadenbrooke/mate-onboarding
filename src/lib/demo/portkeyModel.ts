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

// A tool that takes no arguments streams from the gateway (Claude through
// Portkey) with arguments "" and nothing after it but the finish chunk.
// @ai-sdk/openai v1 emits a streamed tool call only once its arguments parse as
// JSON, and never finalizes a pending one at stream end, so it drops the call:
// the step ends "tool-calls" with no call, no text and no next step, and the
// visitor gets an empty reply. Fix it on the wire: when the finish chunk (or
// [DONE]) arrives, add one chunk that appends "{}" to every call whose
// arguments are still empty. The adapter then parses "{}" and emits the call.
// Calls with real arguments are untouched, and so is every original byte.
type SseChunk = {
  choices?: {
    index?: number
    finish_reason?: string | null
    delta?: { tool_calls?: { index: number; function?: { arguments?: string | null } }[] | null } | null
  }[]
}

export function finalizeEmptyToolArgs(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  // Per tool-call index: the arguments seen so far.
  const args = new Map<number, string>()
  let choiceIndex = 0
  let finished = false
  let carry = ""

  // The added chunk is its own SSE event (an event ends at a blank line), so
  // it goes out only between events, never inside one.
  const closeEmpty = (out: TransformStreamDefaultController<Uint8Array>, prefix = "") => {
    const empty = [...args].filter(([, a]) => a.trim() === "").map(([i]) => i)
    if (empty.length === 0) return
    for (const i of empty) args.set(i, "{}")
    const chunk = {
      choices: [
        {
          index: choiceIndex,
          delta: { tool_calls: empty.map((index) => ({ index, function: { arguments: "{}" } })) },
          finish_reason: null,
        },
      ],
    }
    out.enqueue(encoder.encode(`${prefix}data: ${JSON.stringify(chunk)}\n\n`))
  }

  const line = (raw: string, out: TransformStreamDefaultController<Uint8Array>) => {
    const text = raw.replace(/\r$/, "")
    if (text === "") {
      out.enqueue(encoder.encode(raw + "\n"))
      // The event holding the finish chunk just ended. Its own deltas (if any)
      // are already counted and the adapter has already read the finish reason.
      if (finished) closeEmpty(out)
      return
    }
    if (!text.startsWith("data:")) return out.enqueue(encoder.encode(raw + "\n"))
    const payload = text.slice(5).trim()
    // [DONE] opens its own event, so this is a boundary too (no finish chunk seen).
    if (payload === "[DONE]") closeEmpty(out)
    out.enqueue(encoder.encode(raw + "\n"))
    let json: SseChunk
    try {
      json = JSON.parse(payload) as SseChunk
    } catch {
      return
    }
    const choice = json.choices?.[0]
    if (!choice) return
    choiceIndex = choice.index ?? 0
    for (const call of choice.delta?.tool_calls ?? []) {
      args.set(call.index, (args.get(call.index) ?? "") + (call.function?.arguments ?? ""))
    }
    if (choice.finish_reason != null) finished = true
  }

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, out) {
        carry += decoder.decode(bytes, { stream: true })
        const lines = carry.split("\n")
        carry = lines.pop() ?? ""
        for (const raw of lines) line(raw, out)
      },
      flush(out) {
        carry += decoder.decode()
        if (carry) line(carry, out)
        // The stream may end mid-event; the leading blank line closes it first.
        closeEmpty(out, "\n")
      },
    }),
  )
}

// Read the global fetch per call (tests stub it), and only touch event streams.
const gatewayFetch: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init)
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) return res
  return new Response(finalizeEmptyToolArgs(res.body), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

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
    fetch: gatewayFetch,
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
