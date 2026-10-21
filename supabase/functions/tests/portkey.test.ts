import { assertEquals } from "jsr:@std/assert@1"
import { generateReply } from "../_shared/portkey.ts"

function installFetchStub(): { headers: Record<string, string>; restore: () => void } {
  const realFetch = globalThis.fetch
  let headers: Record<string, string> = {}
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    headers = (init?.headers ?? {}) as Record<string, string>
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return {
    get headers() {
      return headers
    },
    restore: () => {
      globalThis.fetch = realFetch
    },
  }
}

function clearEnv() {
  Deno.env.delete("GEMINI_API_KEY")
  Deno.env.delete("PORTKEY_GATEWAY_KEY")
}

function snapshotEnv(): Record<string, string | undefined> {
  return {
    GEMINI_API_KEY: Deno.env.get("GEMINI_API_KEY"),
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
  Deno.env.set("GEMINI_API_KEY", "test-google-key")
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
  Deno.env.set("GEMINI_API_KEY", "test-google-key")
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
