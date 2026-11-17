import { assertEquals } from "jsr:@std/assert@1"
import { FALLBACK_MODEL, generateReply, isCreditOut } from "../_shared/portkey.ts"

function installFetchStub(): { headers: Record<string, string>; body: Record<string, unknown>; restore: () => void } {
  const realFetch = globalThis.fetch
  let headers: Record<string, string> = {}
  let body: Record<string, unknown> = {}
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    headers = (init?.headers ?? {}) as Record<string, string>
    body = JSON.parse(String(init?.body ?? "{}"))
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return {
    get headers() {
      return headers
    },
    get body() {
      return body
    },
    restore: () => {
      globalThis.fetch = realFetch
    },
  }
}

function clearEnv() {
  Deno.env.delete("ANTHROPIC_API_KEY")
  Deno.env.delete("PORTKEY_GATEWAY_KEY")
}

function snapshotEnv(): Record<string, string | undefined> {
  return {
    ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY"),
    PORTKEY_GATEWAY_KEY: Deno.env.get("PORTKEY_GATEWAY_KEY"),
  }
}

function restoreEnv(previous: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) Deno.env.delete(key)
    else Deno.env.set(key, value)
  }
}

Deno.test("generateReply sends PORTKEY_GATEWAY_KEY when configured", async () => {
  const previous = snapshotEnv()
  clearEnv()
  Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key")
  Deno.env.set("PORTKEY_GATEWAY_KEY", "gateway-test-key")
  const stub = installFetchStub()
  try {
    await generateReply("system", [{ role: "user", content: "hi" }])
    assertEquals(stub.headers["x-amos-gateway-key"], "gateway-test-key")
  } finally {
    stub.restore()
    restoreEnv(previous)
  }
})

Deno.test("generateReply omits PORTKEY_GATEWAY_KEY when unset or blank", async () => {
  const previous = snapshotEnv()
  clearEnv()
  Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key")
  const stub = installFetchStub()
  try {
    for (const value of [undefined, "", "   "]) {
      if (value === undefined) Deno.env.delete("PORTKEY_GATEWAY_KEY")
      else Deno.env.set("PORTKEY_GATEWAY_KEY", value)
      await generateReply("system", [{ role: "user", content: "hi" }])
      assertEquals(stub.headers["x-amos-gateway-key"], undefined)
    }
  } finally {
    stub.restore()
    restoreEnv(previous)
  }
})

Deno.test("generateReply runs on Claude Haiku with the Anthropic key and no Gemini params", async () => {
  const previous = snapshotEnv()
  clearEnv()
  Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key")
  const stub = installFetchStub()
  try {
    assertEquals(await generateReply("system", [{ role: "user", content: "hi" }]), "hello")
    assertEquals(stub.headers["x-portkey-provider"], "anthropic")
    assertEquals(stub.headers["Authorization"], "Bearer test-anthropic-key")
    assertEquals(stub.body.model, "claude-haiku-5-5")
    assertEquals(stub.body.reasoning_effort, undefined)
  } finally {
    stub.restore()
    restoreEnv(previous)
  }
})

// A fetch stub that answers each call from a list and records what was sent.
function installSequenceStub(responses: Response[]) {
  const realFetch = globalThis.fetch
  const sent: { headers: Record<string, string>; body: Record<string, unknown> }[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push({ headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body ?? "{}")) })
    const next = responses.shift()
    if (!next) throw new Error("unexpected fetch")
    return next
  }) as typeof fetch
  return { sent, restore: () => { globalThis.fetch = realFetch } }
}
const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } })
const CREDIT_OUT = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
})

function withKeys(fn: () => Promise<void>) {
  return async () => {
    const previous = { ...snapshotEnv(), OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") }
    clearEnv()
    Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key")
    Deno.env.set("OPENAI_API_KEY", "test-openai-key")
    try {
      await fn()
    } finally {
      restoreEnv(previous)
    }
  }
}

Deno.test("generateReply refuses when ANTHROPIC_API_KEY is missing: nothing is sent, the log names the variable", withKeys(async () => {
  Deno.env.delete("ANTHROPIC_API_KEY")
  const stub = installSequenceStub([])
  const realError = console.error
  const logged: string[] = []
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")) }
  try {
    assertEquals(await generateReply("system", [{ role: "user", content: "hi" }]), "")
    assertEquals(stub.sent.length, 0)
    assertEquals(logged.some((l) => l.includes("ANTHROPIC_API_KEY")), true)
    assertEquals(logged.some((l) => l.includes("test-")), false)
  } finally {
    console.error = realError
    stub.restore()
  }
}))

Deno.test("generateReply retries once on OpenAI when the Claude credit is spent", withKeys(async () => {
  const stub = installSequenceStub([new Response(CREDIT_OUT, { status: 400 }), ok("from openai")])
  const realWarn = console.warn
  console.warn = () => {}
  try {
    assertEquals(await generateReply("system", [{ role: "user", content: "hi" }]), "from openai")
    assertEquals(stub.sent.length, 2)
    assertEquals(stub.sent[1].headers["x-portkey-provider"], "openai")
    assertEquals(stub.sent[1].headers["Authorization"], "Bearer test-openai-key")
    assertEquals(stub.sent[1].body.model, FALLBACK_MODEL.split("/")[1])
  } finally {
    console.warn = realWarn
    stub.restore()
  }
}))

Deno.test("generateReply never falls back on success, an outage, a bad request or a transport error", withKeys(async () => {
  for (const res of [ok(""), new Response("boom", { status: 500 }), new Response("bad", { status: 400 }), new Response("slow", { status: 429 })]) {
    const stub = installSequenceStub([res])
    try {
      await generateReply("system", [{ role: "user", content: "hi" }])
      assertEquals(stub.sent.length, 1)
    } finally {
      stub.restore()
    }
  }
}))

Deno.test("isCreditOut matches only Anthropic's out-of-credit answers", () => {
  assertEquals(isCreditOut(400, CREDIT_OUT), true)
  assertEquals(isCreditOut(402, ""), true)
  assertEquals(isCreditOut(400, "max_tokens required"), false)
  assertEquals(isCreditOut(500, "credit balance is too low"), false)
})
