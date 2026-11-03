import { assert, assertEquals } from "jsr:@std/assert@1"
import { pdwDivertUrl, pdwKeyword } from "../_shared/pdw.ts"
import { handler } from "../demo-sms/handler.ts"

const PDW_URL = "https://pdw-test.invalid/webhook/pdw-sms-consent"
const BOTC_HOST = "https://botc-test.invalid"
const DEMO_HOST = "https://demo-test.invalid"
const SENDER = "+18015550123"
const SIGNATURE = "dGVzdC1zaWduYXR1cmU="
const TIMESTAMP = "1767225600"
const PLAYER = { game_id: "game-1", player_id: "player-1", seat: 2 }
const JSON_HEADERS = { "content-type": "application/json" }

function clearEnv() {
  const keys = [
    "PDW_SMS_DIVERT_URL",
    "BOTC_SUPABASE_URL",
    "BOTC_SERVICE_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DEMO_SMS_TOKEN",
    "DENO_DEPLOYMENT_ID",
    "DEMO_ENV",
    "TELNYX_PUBLIC_KEY",
  ]
  const previous = new Map(keys.map((key) => [key, Deno.env.get(key)]))
  for (const key of keys) Deno.env.delete(key)
  Deno.env.set("SUPABASE_URL", DEMO_HOST)
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "demo-test-key")
  return () => {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  }
}

function setupPdw() {
  Deno.env.set("PDW_SMS_DIVERT_URL", PDW_URL)
}

function setupBotc() {
  Deno.env.set("BOTC_SUPABASE_URL", BOTC_HOST)
  Deno.env.set("BOTC_SERVICE_KEY", "botc-test-key")
}

// A Telnyx inbound-message webhook. The extra non-ASCII field proves the forward
// is byte-exact, not a re-serialized or re-decoded copy.
function telnyxBody(text: string, eventType = "message.received") {
  return JSON.stringify({
    data: {
      event_type: eventType,
      id: "evt-1",
      payload: { direction: "inbound", from: { phone_number: SENDER }, text, note: "café ✓" },
    },
  }) + "\n"
}

function request(text: string, opts: { eventType?: string; signed?: boolean } = {}) {
  const headers: Record<string, string> = { ...JSON_HEADERS }
  if (opts.signed !== false) {
    headers["telnyx-signature-ed25519"] = SIGNATURE
    headers["telnyx-timestamp"] = TIMESTAMP
  }
  return new Request("https://demo.test/functions/v1/demo-sms", {
    method: "POST",
    headers,
    body: telnyxBody(text, opts.eventType),
  })
}

interface PdwCall {
  method: string
  headers: Headers
  body: Uint8Array
}

type PdwAnswer = () => Response | Promise<Response>

/**
 * Stub fetch for the PDW workflow, the botc project and the demo project. The
 * demo rpc answers false, so a fall-through reaches the demo path but never sends.
 */
function stubFetch(pdwAnswer: PdwAnswer, botcPlayer: unknown[] = []) {
  const calls: string[] = []
  const pdwCalls: PdwCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push(url)
    if (url === PDW_URL) {
      const body = new Uint8Array(init?.body as ArrayBuffer)
      pdwCalls.push({ method: init?.method ?? "GET", headers: new Headers(init?.headers), body })
      return await pdwAnswer()
    }
    if (url.startsWith(BOTC_HOST) && url.includes("/rpc/active_game_player")) {
      return new Response(JSON.stringify(botcPlayer), { status: 200, headers: JSON_HEADERS })
    }
    if (url.startsWith(BOTC_HOST) && url.includes("/sms_inbox")) {
      return new Response("[]", { status: 201, headers: JSON_HEADERS })
    }
    if (url.startsWith(DEMO_HOST) && url.includes("/rpc/")) {
      return new Response("false", { status: 200, headers: JSON_HEADERS })
    }
    return new Response("[]", { status: 200, headers: JSON_HEADERS })
  }
  return {
    calls,
    pdwCalls,
    reachedDemo: () => calls.some((url) => url.startsWith(DEMO_HOST)),
    reachedBotc: () => calls.some((url) => url.startsWith(BOTC_HOST)),
    storedToBotc: () => calls.some((url) => url.startsWith(BOTC_HOST) && url.includes("/sms_inbox")),
    restore: () => (globalThis.fetch = original),
  }
}

const handled = () => Response.json({ handled: true, result: "opted_in" })

/** Capture console.error lines so tests can prove no body or number is logged. */
function captureErrors() {
  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "))
  return { lines, restore: () => (console.error = original) }
}

Deno.test("pdwKeyword matches each keyword, any case, trimmed, trailing punctuation ignored", () => {
  for (const word of ["YES", "START", "UNSTOP", "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "HELP"]) {
    assertEquals(pdwKeyword(word), word)
    assertEquals(pdwKeyword(word.toLowerCase()), word)
  }
  assertEquals(pdwKeyword("  Yes! "), "YES")
  assertEquals(pdwKeyword("stop."), "STOP")
  assertEquals(pdwKeyword("Help?!"), "HELP")
  assertEquals(pdwKeyword("quit ."), "QUIT")
  assertEquals(pdwKeyword("\nStart\n"), "START")
})

Deno.test("pdwKeyword rejects anything that is not exactly one keyword", () => {
  for (const text of ["", "   ", "yes please", "stop it", "yess", "y es", "!yes", "no", "123456", "hello", "STOP STOP", "yes \u{1F44D}"]) {
    assertEquals(pdwKeyword(text), null, text)
  }
})

Deno.test("pdwDivertUrl is disabled unless PDW_SMS_DIVERT_URL is an https URL", () => {
  const restoreEnv = clearEnv()
  const errors = captureErrors()
  try {
    assertEquals(pdwDivertUrl(), null)
    Deno.env.set("PDW_SMS_DIVERT_URL", "http://pdw-test.invalid/hook")
    assertEquals(pdwDivertUrl(), null)
    Deno.env.set("PDW_SMS_DIVERT_URL", "not a url")
    assertEquals(pdwDivertUrl(), null)
    Deno.env.set("PDW_SMS_DIVERT_URL", PDW_URL)
    assertEquals(pdwDivertUrl(), PDW_URL)
  } finally {
    errors.restore(); restoreEnv()
  }
})

Deno.test("keyword forwards the exact raw bytes and both Telnyx headers", async () => {
  const restoreEnv = clearEnv(); setupPdw()
  const fetchStub = stubFetch(handled)
  try {
    const req = request("Yes!")
    const expected = new Uint8Array(await req.clone().arrayBuffer())
    await handler(req)
    assertEquals(fetchStub.pdwCalls.length, 1)
    const call = fetchStub.pdwCalls[0]
    assertEquals(call.method, "POST")
    assertEquals(call.body, expected)
    assertEquals(call.headers.get("telnyx-signature-ed25519"), SIGNATURE)
    assertEquals(call.headers.get("telnyx-timestamp"), TIMESTAMP)
    assertEquals(call.headers.get("content-type"), "application/json")
  } finally {
    fetchStub.restore(); restoreEnv()
  }
})

Deno.test("handled:true ACKs Telnyx and stops before any demo work", async () => {
  for (const text of ["YES", "stop", "HELP."]) {
    const restoreEnv = clearEnv(); setupPdw()
    const fetchStub = stubFetch(handled)
    try {
      const response = await handler(request(text))
      assertEquals(response.status, 200)
      assertEquals(await response.text(), "ok")
      assertEquals(fetchStub.pdwCalls.length, 1)
      assertEquals(fetchStub.reachedDemo(), false, text)
    } finally {
      fetchStub.restore(); restoreEnv()
    }
  }
})

const FAILURES: Record<string, PdwAnswer> = {
  "handled:false": () => Response.json({ handled: false }),
  "handled as a string": () => Response.json({ handled: "true" }),
  "missing handled": () => Response.json({ result: "ok" }),
  "non-200 with handled:true": () => Response.json({ handled: true }, { status: 202 }),
  "server error": () => new Response("boom", { status: 500 }),
  "bad JSON": () => new Response("not json", { status: 200, headers: JSON_HEADERS }),
  "network error": () => Promise.reject(new TypeError("connection refused")),
}

for (const [name, answer] of Object.entries(FAILURES)) {
  Deno.test(`PDW ${name} falls through to the normal demo path`, async () => {
    const restoreEnv = clearEnv(); setupPdw()
    const fetchStub = stubFetch(answer)
    const errors = captureErrors()
    try {
      const response = await handler(request("YES"))
      assertEquals(response.status, 200)
      assertEquals(fetchStub.pdwCalls.length, 1)
      assert(fetchStub.reachedDemo())
    } finally {
      errors.restore(); fetchStub.restore(); restoreEnv()
    }
  })
}

Deno.test("PDW timeout falls through to the normal demo path", async () => {
  const restoreEnv = clearEnv(); setupPdw()
  const original = globalThis.fetch
  let pdwCalled = false
  let reachedDemo = false
  globalThis.fetch = (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === PDW_URL) {
      pdwCalled = true
      // Never answers; only the divert's own abort signal ends the wait.
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))
    }
    if (url.startsWith(DEMO_HOST)) reachedDemo = true
    const body = url.includes("/rpc/") ? "false" : "[]"
    return Promise.resolve(new Response(body, { status: 200, headers: JSON_HEADERS }))
  }
  const errors = captureErrors()
  try {
    const started = Date.now()
    const response = await handler(request("STOP"))
    const waited = Date.now() - started
    assertEquals(response.status, 200)
    assert(pdwCalled)
    assert(reachedDemo)
    assert(waited >= 2900 && waited < 6000, `waited ${waited}ms`)
    assert(errors.lines.some((line) => line.includes("TimeoutError")))
  } finally {
    errors.restore(); globalThis.fetch = original; restoreEnv()
  }
})

Deno.test("env unset: keywords are never forwarded and the demo path runs", async () => {
  for (const text of ["YES", "STOP"]) {
    const restoreEnv = clearEnv()
    const fetchStub = stubFetch(handled)
    try {
      const response = await handler(request(text))
      assertEquals(response.status, 200)
      assertEquals(fetchStub.pdwCalls.length, 0)
      assert(fetchStub.reachedDemo())
    } finally {
      fetchStub.restore(); restoreEnv()
    }
  }
})

Deno.test("non-keyword texts are never forwarded", async () => {
  for (const text of ["yes please", "hello", "stop texting me", "123456", ""]) {
    const restoreEnv = clearEnv(); setupPdw()
    const fetchStub = stubFetch(handled)
    try {
      await handler(request(text))
      assertEquals(fetchStub.pdwCalls.length, 0, text)
      assert(fetchStub.reachedDemo(), text)
    } finally {
      fetchStub.restore(); restoreEnv()
    }
  }
})

Deno.test("non-inbound events and form posts are never forwarded", async () => {
  const restoreEnv = clearEnv(); setupPdw()
  const fetchStub = stubFetch(handled)
  try {
    await handler(request("STOP", { eventType: "message.finalized" }))
    await handler(new Request("https://demo.test/functions/v1/demo-sms", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `From=${encodeURIComponent(SENDER)}&Body=STOP`,
    }))
    assertEquals(fetchStub.pdwCalls.length, 0)
  } finally {
    fetchStub.restore(); restoreEnv()
  }
})

Deno.test("unsigned keyword is not forwarded and falls through", async () => {
  const restoreEnv = clearEnv(); setupPdw()
  const fetchStub = stubFetch(handled)
  const errors = captureErrors()
  try {
    const response = await handler(request("YES", { signed: false }))
    assertEquals(response.status, 200)
    assertEquals(fetchStub.pdwCalls.length, 0)
    assert(fetchStub.reachedDemo())
  } finally {
    errors.restore(); fetchStub.restore(); restoreEnv()
  }
})

Deno.test("failed demo-sms auth returns 401 without forwarding", async () => {
  const restoreEnv = clearEnv(); setupPdw()
  // A configured key makes the dummy signature fail verification.
  Deno.env.set("TELNYX_PUBLIC_KEY", btoa(String.fromCharCode(...new Uint8Array(32).fill(7))))
  const fetchStub = stubFetch(handled)
  try {
    const response = await handler(request("YES"))
    assertEquals(response.status, 401)
    assertEquals(fetchStub.calls.length, 0)
  } finally {
    fetchStub.restore(); restoreEnv()
  }
})

Deno.test("opt-out keyword goes to PDW before the BOTC divert", async () => {
  const restoreEnv = clearEnv(); setupPdw(); setupBotc()
  const fetchStub = stubFetch(handled, [PLAYER])
  try {
    const response = await handler(request("STOP"))
    assertEquals(response.status, 200)
    assertEquals(fetchStub.pdwCalls.length, 1)
    assertEquals(fetchStub.reachedBotc(), false)
    assertEquals(fetchStub.reachedDemo(), false)
  } finally {
    fetchStub.restore(); restoreEnv()
  }
})

Deno.test("opt-out keyword not handled by PDW still reaches a BOTC player's game", async () => {
  const restoreEnv = clearEnv(); setupPdw(); setupBotc()
  const fetchStub = stubFetch(() => Response.json({ handled: false }), [PLAYER])
  const errors = captureErrors()
  try {
    const response = await handler(request("stop"))
    assertEquals(response.status, 200)
    assertEquals(fetchStub.pdwCalls.length, 1)
    assert(fetchStub.storedToBotc())
    assertEquals(fetchStub.reachedDemo(), false)
  } finally {
    errors.restore(); fetchStub.restore(); restoreEnv()
  }
})

Deno.test("opt-in keyword from a BOTC player goes to the game, never to PDW", async () => {
  const restoreEnv = clearEnv(); setupPdw(); setupBotc()
  const fetchStub = stubFetch(handled, [PLAYER])
  try {
    const response = await handler(request("yes"))
    assertEquals(response.status, 200)
    assertEquals(fetchStub.pdwCalls.length, 0)
    assert(fetchStub.storedToBotc())
  } finally {
    fetchStub.restore(); restoreEnv()
  }
})

Deno.test("opt-in keyword from a non-player goes to PDW after the BOTC lookup", async () => {
  const restoreEnv = clearEnv(); setupPdw(); setupBotc()
  const fetchStub = stubFetch(handled)
  try {
    const response = await handler(request("YES"))
    assertEquals(response.status, 200)
    assertEquals(fetchStub.pdwCalls.length, 1)
    const botcLookup = fetchStub.calls.findIndex((url) => url.includes("/rpc/active_game_player"))
    assert(botcLookup >= 0 && botcLookup < fetchStub.calls.indexOf(PDW_URL))
    assertEquals(fetchStub.reachedDemo(), false)
  } finally {
    fetchStub.restore(); restoreEnv()
  }
})

Deno.test("divert logs never carry the message text or the sender number", async () => {
  const restoreEnv = clearEnv(); setupPdw()
  const fetchStub = stubFetch(() => new Response("boom", { status: 500 }))
  const errors = captureErrors()
  try {
    await handler(request("Unsubscribe"))
    assert(errors.lines.length > 0)
    for (const line of errors.lines) {
      assertEquals(line.toLowerCase().includes("unsubscribe"), false, line)
      assertEquals(line.includes("5550123"), false, line)
    }
  } finally {
    errors.restore(); fetchStub.restore(); restoreEnv()
  }
})
