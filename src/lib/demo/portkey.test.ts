import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  modelForClass, TASK_MODELS, TASK_PARAMS, MIN_MAX_TOKENS, FALLBACK_MODEL, chatComplete, portkeyChatStream, isCreditOut,
} from "./portkey"
import { TENANT_TASK_MODELS } from "./tenantModels"

describe("modelForClass / TASK_MODELS", () => {
  it("maps both task classes to a cheap model in creator/model form", () => {
    expect(modelForClass("extract")).toMatch(/^[a-z]+\/.+/)
    expect(modelForClass("reply")).toMatch(/^[a-z]+\/.+/)
  })
  it("has an entry for every task class", () => {
    expect(TASK_MODELS.extract).toBeTruthy()
    expect(TASK_MODELS.reply).toBeTruthy()
  })
  // Regression: the demo broke because a REASONING model (gemini-3-flash-preview)
  // burned the whole low max_tokens budget on reasoning and returned empty content.
  // Both task classes must use a non-reasoning model — never the *-preview reasoning tier.
  it("does NOT use the gemini reasoning-preview model for these cheap tasks", () => {
    expect(TASK_MODELS.extract).not.toContain("gemini-3-flash-preview")
    expect(TASK_MODELS.reply).not.toContain("gemini-3-flash-preview")
  })
  // Founder ruling 2026-11-16: "move it all to claude". Haiku for the cheap
  // text classes, Sonnet for the assistant and photo reading.
  it("runs every class on Claude", () => {
    expect(TASK_MODELS).toEqual({
      extract: "anthropic/claude-haiku-5-5",
      reply: "anthropic/claude-haiku-5-5",
      assistant: "anthropic/claude-sonnet-5-5",
      onboarding: "anthropic/claude-sonnet-5-5",
      vision: "anthropic/claude-sonnet-5-5",
    })
  })
  // No paid Gemini call: neither the defaults nor any tenant override names a
  // google model. Re-adding one means re-adding GEMINI_API_KEY to the deploy.
  it("makes no Gemini call from any default or tenant route", () => {
    const all = [...Object.values(TASK_MODELS), ...Object.values(TENANT_TASK_MODELS).flatMap(m => Object.values(m))]
    for (const id of all) expect(id).not.toMatch(/^google\//)
  })
  // TASK_PARAMS are kept for a google model only (paramsFor); Claude gets none.
  it("keeps the Gemini 3.x params for google calls and leaves vision at the model default", () => {
    expect(TASK_PARAMS.extract).toEqual({ reasoning_effort: "minimal" })
    expect(TASK_PARAMS.assistant).toEqual({ reasoning_effort: "minimal" })
    expect(TASK_PARAMS.vision).toBeUndefined()
  })
})

describe("MIN_MAX_TOKENS floors", () => {
  it("gives extraction enough room for a multi-field JSON object", () => {
    expect(MIN_MAX_TOKENS.extract).toBeGreaterThanOrEqual(1024)
  })
  it("leaves room for ~800 hidden reasoning tokens on the 3.x classes", () => {
    expect(MIN_MAX_TOKENS.extract).toBeGreaterThanOrEqual(2048)
    expect(MIN_MAX_TOKENS.assistant).toBeGreaterThanOrEqual(2500)
  })
  it("gives an SMS reply a safe floor", () => {
    expect(MIN_MAX_TOKENS.reply).toBeGreaterThanOrEqual(256)
  })
})

describe("chatComplete over Portkey", () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key"
    process.env.OPENAI_API_KEY = "test-openai-key"
    delete process.env.LLM_PORTKEY_BYPASS
    delete process.env.PORTKEY_BASE_URL
    delete process.env.PORTKEY_GATEWAY_KEY
  })
  afterEach(() => {
    process.env = { ...OLD }
    vi.restoreAllMocks()
  })

  function mockOk(content: string) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )
  }

  it("posts to Portkey /v1/chat/completions with provider + metadata headers", async () => {
    const spy = mockOk("hello back")
    const out = await chatComplete({
      sessionId: null,
      taskClass: "reply",
      system: "you are a bot",
      messages: [{ role: "user", content: "hi" }],
    })
    expect(out).toBe("hello back")
    expect(spy).toHaveBeenCalledOnce()
    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toBe("https://portkey.auto-mate.business/v1/chat/completions")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["x-portkey-provider"]).toBe("anthropic")
    expect(headers.Authorization).toBe("Bearer test-anthropic-key")
    expect(headers["x-portkey-metadata"]).toContain("mate-onboarding")
    expect(headers["x-amos-gateway-key"]).toBeUndefined()
    // Bare model name forwarded upstream (creator/ prefix stripped).
    const payload = JSON.parse(String((init as RequestInit).body))
    expect(payload.model).not.toContain("/")
    expect(payload.messages[0]).toEqual({ role: "system", content: "you are a bot" })
  })

  it("sends PORTKEY_GATEWAY_KEY to the Portkey gateway", async () => {
    process.env.PORTKEY_GATEWAY_KEY = "gateway-test-key"
    const spy = mockOk("hello back")

    await chatComplete({
      sessionId: null,
      taskClass: "reply",
      messages: [{ role: "user", content: "hi" }],
    })

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers["x-amos-gateway-key"]).toBe("gateway-test-key")
  })

  it("omits PORTKEY_GATEWAY_KEY when it is blank", async () => {
    process.env.PORTKEY_GATEWAY_KEY = "   "
    const spy = mockOk("hello back")

    await chatComplete({
      sessionId: null,
      taskClass: "reply",
      messages: [{ role: "user", content: "hi" }],
    })

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers["x-amos-gateway-key"]).toBeUndefined()
  })

  it("sends PORTKEY_GATEWAY_KEY on the streaming Portkey request", async () => {
    process.env.PORTKEY_GATEWAY_KEY = "gateway-test-key"
    const spy = mockOk("hello back")

    await portkeyChatStream({
      sessionId: null,
      taskClass: "assistant",
      messages: [{ role: "user", content: "hi" }],
    })

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers["x-amos-gateway-key"]).toBe("gateway-test-key")
  })

  it("does not send PORTKEY_GATEWAY_KEY on the provider-native bypass", async () => {
    const models = TASK_MODELS as unknown as { assistant: string }
    const originalModel = models.assistant
    models.assistant = "openai/gpt-4o-mini"
    process.env.LLM_PORTKEY_BYPASS = "1"
    process.env.PORTKEY_GATEWAY_KEY = "gateway-test-key"
    process.env.OPENAI_API_KEY = "test-openai-key"
    const spy = mockOk("hello back")

    try {
      await portkeyChatStream({ sessionId: null, taskClass: "assistant", messages: [{ role: "user", content: "hi" }] })

      const [url, init] = spy.mock.calls[0]
      const headers = (init as RequestInit).headers as Record<string, string>
      expect(String(url)).toBe("https://api.openai.com/v1/chat/completions")
      expect(headers["x-amos-gateway-key"]).toBeUndefined()
    } finally {
      models.assistant = originalModel
    }
  })

  it("clamps max_tokens UP to the per-class floor so a swap can't truncate to empty", async () => {
    const spy = mockOk("ok")
    // caller passes a too-small budget; must be clamped up to the extract floor (2048)
    await chatComplete({ sessionId: null, taskClass: "extract", maxTokens: 50, messages: [{ role: "user", content: "hi" }] })
    const payload = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(payload.max_tokens).toBe(MIN_MAX_TOKENS.extract)
  })

  it("sends the Gemini TASK_PARAMS only when a class runs on google", async () => {
    const models = TASK_MODELS as unknown as { extract: string }
    const originalModel = models.extract
    process.env.GEMINI_API_KEY = "test-google-key"
    const spy = mockOk("ok")
    try {
      await chatComplete({ sessionId: null, taskClass: "extract", messages: [{ role: "user", content: "hi" }] })
      models.extract = "google/gemini-3.6-flash"
      await chatComplete({ sessionId: null, taskClass: "extract", messages: [{ role: "user", content: "hi" }] })
    } finally {
      models.extract = originalModel
    }
    const claudeBody = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    const geminiBody = JSON.parse(String((spy.mock.calls[1][1] as RequestInit).body))
    expect(claudeBody).toMatchObject({ model: "claude-haiku-5-5" })
    expect(claudeBody.reasoning_effort).toBeUndefined()
    expect(geminiBody).toMatchObject({ model: "gemini-3.6-flash", reasoning_effort: "minimal" })
  })

  it("streams the assistant on Claude Sonnet with no Gemini params", async () => {
    const spy = mockOk("ok")
    await portkeyChatStream({ sessionId: null, taskClass: "assistant", messages: [{ role: "user", content: "hi" }] })
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", stream: true })
    expect(body.reasoning_effort).toBeUndefined()
  })

  it("sends no extra params for a class without TASK_PARAMS", async () => {
    const spy = mockOk("ok")
    await chatComplete({ sessionId: null, taskClass: "reply", messages: [{ role: "user", content: "hi" }] })
    const payload = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(payload.reasoning_effort).toBeUndefined()
  })

  it("keeps a caller's max_tokens when it already exceeds the floor", async () => {
    const spy = mockOk("ok")
    await chatComplete({ sessionId: null, taskClass: "reply", maxTokens: 999, messages: [{ role: "user", content: "hi" }] })
    const payload = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(payload.max_tokens).toBe(999)
  })

  it("honors PORTKEY_BASE_URL override", async () => {
    process.env.PORTKEY_BASE_URL = "http://localhost:8787"
    const spy = mockOk("x")
    await chatComplete({ sessionId: null, taskClass: "extract", messages: [{ role: "user", content: "hi" }] })
    expect(String(spy.mock.calls[0][0])).toBe("http://localhost:8787/v1/chat/completions")
  })

  it("returns empty string on a non-OK response (caller falls back, never throws)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }))
    const out = await chatComplete({ sessionId: null, taskClass: "reply", messages: [{ role: "user", content: "hi" }] })
    expect(out).toBe("")
  })

  it("returns empty string when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"))
    const out = await chatComplete({ sessionId: null, taskClass: "reply", messages: [{ role: "user", content: "hi" }] })
    expect(out).toBe("")
  })
})

describe("credit-out fallback on the text classes", () => {
  const OLD = { ...process.env }
  const CREDIT_OUT = JSON.stringify({
    type: "error",
    error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
  })
  const ok = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  let fetchMock: ReturnType<typeof vi.fn>
  const providerOf = (i: number) =>
    ((fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>)["x-portkey-provider"]
  const modelOf = (i: number) => JSON.parse(String((fetchMock.mock.calls[i][1] as RequestInit).body)).model
  const msg = [{ role: "user" as const, content: "hi" }]

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key"
    process.env.OPENAI_API_KEY = "test-openai-key"
    delete process.env.LLM_PORTKEY_BYPASS
    delete process.env.PORTKEY_GATEWAY_KEY
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    process.env = { ...OLD }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("recognizes Anthropic's out-of-credit answers and nothing else", () => {
    expect(isCreditOut(400, CREDIT_OUT)).toBe(true)
    expect(isCreditOut(402, "")).toBe(true)
    expect(isCreditOut(400, '{"error":{"type":"billing_error"}}')).toBe(true)
    expect(isCreditOut(400, "max_tokens: field required")).toBe(false)
    expect(isCreditOut(429, "rate limited")).toBe(false)
    expect(isCreditOut(500, "credit balance is too low")).toBe(false)
  })

  it("chatComplete retries once on OpenAI when the Claude credit is spent", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(CREDIT_OUT, { status: 400 }))
      .mockResolvedValueOnce(ok("from openai"))
    expect(await chatComplete({ sessionId: null, taskClass: "extract", messages: msg })).toBe("from openai")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(providerOf(0)).toBe("anthropic")
    expect(providerOf(1)).toBe("openai")
    expect(modelOf(1)).toBe(FALLBACK_MODEL.split("/")[1])
  })

  it("chatComplete never falls back on success, even an empty one", async () => {
    fetchMock.mockResolvedValueOnce(ok(""))
    expect(await chatComplete({ sessionId: null, taskClass: "extract", messages: msg })).toBe("")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("chatComplete does not fall back on an outage, a bad request, or a transport error", async () => {
    for (const res of [new Response("boom", { status: 500 }), new Response("bad", { status: 400 }), new Response("slow", { status: 429 })]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(res)
      expect(await chatComplete({ sessionId: null, taskClass: "extract", messages: msg })).toBe("")
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
    fetchMock.mockReset()
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"))
    expect(await chatComplete({ sessionId: null, taskClass: "extract", messages: msg })).toBe("")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("chatComplete does not fall back when the Anthropic key is missing: nothing is sent", async () => {
    delete process.env.ANTHROPIC_API_KEY
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await chatComplete({ sessionId: null, taskClass: "extract", messages: msg })).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("portkeyChatStream retries once on OpenAI when the Claude credit is spent", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(CREDIT_OUT, { status: 400 }))
      .mockResolvedValueOnce(new Response("data: {}\n\n", { status: 200 }))
    const res = await portkeyChatStream({ sessionId: null, taskClass: "assistant", messages: msg })
    expect(res.ok).toBe(true)
    expect(providerOf(1)).toBe("openai")
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).stream).toBe(true)
  })

  it("portkeyChatStream passes any other failure through untouched", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 503 }))
    const res = await portkeyChatStream({ sessionId: null, taskClass: "assistant", messages: msg })
    expect(res.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
