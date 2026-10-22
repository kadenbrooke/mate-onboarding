import { assert, assertEquals } from "jsr:@std/assert@1"
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4"
import { botcClient, botcInboxInsert, findActiveBotcPlayer } from "../_shared/botc.ts"
import { handler } from "../demo-sms/handler.ts"

const BOTC_HOST = "https://botc-test.invalid"
const DEMO_HOST = "https://demo-test.invalid"
const PLAYER = { game_id: "game-1", player_id: "player-1", seat: 2 }

function clearEnv() {
  for (const key of [
    "BOTC_SUPABASE_URL",
    "BOTC_SERVICE_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DEMO_SMS_TOKEN",
    "DENO_DEPLOYMENT_ID",
    "DEMO_ENV",
    "TELNYX_PUBLIC_KEY",
  ]) Deno.env.delete(key)
}

function request(from: string, body: string) {
  return new Request("https://demo.test/functions/v1/demo-sms", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `From=${encodeURIComponent(from)}&Body=${encodeURIComponent(body)}`,
  })
}

function stubFetch(playerResponse: Response) {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (input: Request | URL | string): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push(url)
    const headers = { "content-type": "application/json" }
    if (url.startsWith(BOTC_HOST) && url.includes("/rpc/active_game_player")) {
      return playerResponse
    }
    if (url.startsWith(BOTC_HOST) && url.includes("/sms_inbox")) {
      return new Response("[]", { status: 201, headers })
    }
    if (url.startsWith(DEMO_HOST) && url.includes("/rpc/")) {
      return new Response("false", { status: 200, headers })
    }
    return new Response("[]", { status: 200, headers })
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

function setupDemo() {
  Deno.env.set("SUPABASE_URL", DEMO_HOST)
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "demo-test-key")
}

function setupBotc() {
  Deno.env.set("BOTC_SUPABASE_URL", BOTC_HOST)
  Deno.env.set("BOTC_SERVICE_KEY", "botc-test-key")
}

Deno.test("botcClient is disabled unless both BOTC envs are set", () => {
  clearEnv()
  assertEquals(botcClient(), null)
  Deno.env.set("BOTC_SUPABASE_URL", BOTC_HOST)
  assertEquals(botcClient(), null)
  Deno.env.set("BOTC_SERVICE_KEY", "botc-test-key")
  assert(botcClient() !== null)
  clearEnv()
})

Deno.test("handler with BOTC envs unset reaches the normal demo code path", async () => {
  clearEnv()
  setupDemo()
  const fetchStub = stubFetch(new Response("[]", { status: 200 }))
  try {
    const response = await handler(request("+18015551234", "123456"))
    assertEquals(response.status, 200)
    assert(fetchStub.calls.some((url) => url.startsWith(DEMO_HOST) && url.includes("/rpc/demo_counter_bump")))
    assertEquals(fetchStub.calls.some((url) => url.startsWith(BOTC_HOST)), false)
  } finally {
    fetchStub.restore()
    clearEnv()
  }
})

Deno.test("active BOTC player is diverted before the six-digit demo path", async () => {
  clearEnv(); setupDemo(); setupBotc()
  const fetchStub = stubFetch(new Response(JSON.stringify([PLAYER]), { status: 200, headers: { "content-type": "application/json" } }))
  try {
    const response = await handler(request("+18014583118", " 123456 "))
    assertEquals(response.status, 200)
    assertEquals(await response.text(), "ok")
    assert(fetchStub.calls.some((url) => url.startsWith(BOTC_HOST) && url.includes("/rpc/active_game_player")))
    assert(fetchStub.calls.some((url) => url.startsWith(BOTC_HOST) && url.includes("/sms_inbox")))
    assertEquals(fetchStub.calls.some((url) => url.startsWith(DEMO_HOST)), false)
  } finally {
    fetchStub.restore(); clearEnv()
  }
})

Deno.test("BOTC lookup miss falls through to the normal demo path", async () => {
  clearEnv(); setupDemo(); setupBotc()
  const fetchStub = stubFetch(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }))
  try {
    const response = await handler(request("+18015551234", "123456"))
    assertEquals(response.status, 200)
    assert(fetchStub.calls.some((url) => url.startsWith(DEMO_HOST) && url.includes("/rpc/demo_counter_bump")))
  } finally {
    fetchStub.restore(); clearEnv()
  }
})

Deno.test("BOTC inbox failure returns 500 so Telnyx retries", async () => {
  clearEnv(); setupDemo(); setupBotc()
  const original = globalThis.fetch
  globalThis.fetch = async (input: Request | URL | string): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes("/rpc/active_game_player")) {
      return new Response(JSON.stringify([PLAYER]), { status: 200, headers: { "content-type": "application/json" } })
    }
    if (url.includes("/sms_inbox")) return new Response(JSON.stringify({ message: "insert failed" }), { status: 500 })
    return new Response("false", { status: 200, headers: { "content-type": "application/json" } })
  }
  try {
    assertEquals((await handler(request("+18014583118", "hello"))).status, 500)
  } finally {
    globalThis.fetch = original; clearEnv()
  }
})

Deno.test("BOTC helpers fail open on lookup errors and report insert errors", async () => {
  assertEquals(await findActiveBotcPlayer({ rpc: () => Promise.reject(new Error("lookup failed")) } as unknown as SupabaseClient, "+1801"), null)
  assertEquals(await botcInboxInsert({ from: () => ({ insert: () => Promise.resolve({ error: { message: "insert failed" } }) }) } as unknown as SupabaseClient, "game-1", "+1801", "hello"), false)
})
