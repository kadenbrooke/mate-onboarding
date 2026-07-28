import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { modelForClass, TASK_MODELS, MIN_MAX_TOKENS, chatComplete } from "./portkey"

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
})

describe("MIN_MAX_TOKENS floors", () => {
  it("gives extraction enough room for a multi-field JSON object", () => {
    expect(MIN_MAX_TOKENS.extract).toBeGreaterThanOrEqual(1024)
  })
  it("gives an SMS reply a safe floor", () => {
    expect(MIN_MAX_TOKENS.reply).toBeGreaterThanOrEqual(256)
  })
})

describe("chatComplete over Portkey", () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-google-key"
    delete process.env.LLM_PORTKEY_BYPASS
    delete process.env.PORTKEY_BASE_URL
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
      taskClass: "reply",
      system: "you are a bot",
      messages: [{ role: "user", content: "hi" }],
    })
    expect(out).toBe("hello back")
    expect(spy).toHaveBeenCalledOnce()
    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toBe("https://portkey.auto-mate.business/v1/chat/completions")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["x-portkey-provider"]).toBe("google")
    expect(headers.Authorization).toBe("Bearer test-google-key")
    expect(headers["x-portkey-metadata"]).toContain("mate-onboarding")
    // Bare model name forwarded upstream (creator/ prefix stripped).
    const payload = JSON.parse(String((init as RequestInit).body))
    expect(payload.model).not.toContain("/")
    expect(payload.messages[0]).toEqual({ role: "system", content: "you are a bot" })
  })

  it("clamps max_tokens UP to the per-class floor so a swap can't truncate to empty", async () => {
    const spy = mockOk("ok")
    // caller passes a too-small budget; must be clamped up to the extract floor (1024)
    await chatComplete({ taskClass: "extract", maxTokens: 50, messages: [{ role: "user", content: "hi" }] })
    const payload = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(payload.max_tokens).toBe(MIN_MAX_TOKENS.extract)
  })

  it("keeps a caller's max_tokens when it already exceeds the floor", async () => {
    const spy = mockOk("ok")
    await chatComplete({ taskClass: "reply", maxTokens: 999, messages: [{ role: "user", content: "hi" }] })
    const payload = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(payload.max_tokens).toBe(999)
  })

  it("honors PORTKEY_BASE_URL override", async () => {
    process.env.PORTKEY_BASE_URL = "http://localhost:8787"
    const spy = mockOk("x")
    await chatComplete({ taskClass: "extract", messages: [{ role: "user", content: "hi" }] })
    expect(String(spy.mock.calls[0][0])).toBe("http://localhost:8787/v1/chat/completions")
  })

  it("returns empty string on a non-OK response (caller falls back, never throws)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }))
    const out = await chatComplete({ taskClass: "reply", messages: [{ role: "user", content: "hi" }] })
    expect(out).toBe("")
  })

  it("returns empty string when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"))
    const out = await chatComplete({ taskClass: "reply", messages: [{ role: "user", content: "hi" }] })
    expect(out).toBe("")
  })
})
