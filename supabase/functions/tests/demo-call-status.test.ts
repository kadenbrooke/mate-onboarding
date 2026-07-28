import { assertEquals } from "jsr:@std/assert@1"
import { handleCallEnded, handleCallStatus } from "../demo-call-status/index.ts"
import { adminClient } from "../_shared/db.ts"
import { TEXT_SENT_SCOPE } from "../_shared/voicemail.ts"

// The hangup catch-all (StatusCallback safety net). Two layers of coverage:
//   1. handleCallStatus: auth + immediate ACK routing (no live I/O).
//   2. handleCallEnded: the deferred body over a routed fetch() stub, proving the
//      full matrix -- early hangup sends generic, VM-claimed pre-empts, unknown
//      caller stays silent -- and that the claim is the shared one-text guard.
//
// handleCallEnded SLEEPS for the catch-all buffer. Tests set the delay env to 0-ish
// AND stub Deno's timer via a short delay so runs stay fast; more importantly the
// claim ordering is proven deterministically in voicemail.test.ts (runHangupCatchall
// with injected sleep). Here we drive the real function end-to-end with a tiny wait.

function callStatusReq(body: string, token = "vtok"): Request {
  return new Request(`https://dummy.supabase.co/functions/v1/demo-call-status?k=${token}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
}

// ---- 1. handleCallStatus: auth + ACK routing ----------------------------------

function clearAuthEnv() {
  Deno.env.delete("DENO_DEPLOYMENT_ID")
  Deno.env.delete("DEMO_ENV")
  Deno.env.delete("TELNYX_PUBLIC_KEY")
  Deno.env.delete("DEMO_VOICE_TOKEN")
  Deno.env.delete("SUPABASE_URL")
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY")
}

Deno.test("handleCallStatus: rejected in prod with no token + no signature", async () => {
  clearAuthEnv()
  Deno.env.set("DENO_DEPLOYMENT_ID", "deploy-xyz") // simulate prod
  const res = await handleCallStatus(
    callStatusReq("CallSid=c1&From=%2B18015551234&CallStatus=no-answer", "wrong")
  )
  assertEquals(res.status, 401)
  clearAuthEnv()
})

Deno.test("handleCallStatus: valid ?k token -> 200 ACK (does not block on the deferred work)", async () => {
  clearAuthEnv()
  Deno.env.set("DEMO_VOICE_TOKEN", "vtok")
  Deno.env.set("SUPABASE_URL", "https://dummy.supabase.co")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "dummy")
  // No EdgeRuntime in the test runtime -> runAfterResponse no-ops, so no live I/O
  // fires here; we're asserting the fast 200 ACK + token auth only.
  const res = await handleCallStatus(
    callStatusReq("CallSid=c2&From=%2B18015551234&CallStatus=completed")
  )
  assertEquals(res.status, 200)
  assertEquals(await res.text(), "ok")
  clearAuthEnv()
})

// ---- 2. handleCallEnded: deferred body over a fetch() stub --------------------

interface StubState {
  counts: Map<string, number>
  sentBodies: string[]
  session: Record<string, unknown> | null
}

function installFetchStub(session: Record<string, unknown> | null): {
  state: StubState
  restore: () => void
} {
  const realFetch = globalThis.fetch
  const state: StubState = { counts: new Map(), sentBodies: [], session }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const bodyText = typeof init?.body === "string" ? init.body : ""

    if (url.includes("/rest/v1/rpc/demo_counter_bump")) {
      const args = JSON.parse(bodyText) as { p_scope: string; p_key: string; p_cap: number }
      const k = `${args.p_scope}:${args.p_key}`
      const n = state.counts.get(k) ?? 0
      const allowed = n < args.p_cap
      if (allowed) state.counts.set(k, n + 1)
      return json(allowed)
    }
    if (url.includes("/rest/v1/demo_sessions")) return json(state.session)
    if (url.includes("api.telnyx.com/v2/messages")) {
      try {
        state.sentBodies.push((JSON.parse(bodyText) as { text?: string }).text ?? "")
      } catch {
        state.sentBodies.push("")
      }
      return json({ data: { id: "msg-1" } })
    }
    return json({}, 200)
  }) as typeof fetch

  return { state, restore: () => { globalThis.fetch = realFetch } }
}

function setEnv() {
  Deno.env.set("SUPABASE_URL", "https://dummy.supabase.co")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "dummy")
  Deno.env.set("TELNYX_API_KEY", "tk")
  Deno.env.set("DEMO_TELNYX_NUMBER", "+13854409744")
  // Keep the catch-all buffer near-zero so the end-to-end test doesn't actually
  // sleep 45s. The ORDERING invariant is proven separately with an injected sleep.
  Deno.env.set("DEMO_HANGUP_CATCHALL_DELAY_SECONDS", "0.01")
}
function clearEnv() {
  for (
    const k of [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "TELNYX_API_KEY",
      "DEMO_TELNYX_NUMBER",
      "DEMO_HANGUP_CATCHALL_DELAY_SECONDS",
    ]
  ) Deno.env.delete(k)
}

const READY_SESSION = {
  id: "sess-1",
  phone: "+18015551234",
  phone_code: null,
  status: "ready",
  fr_config: {
    system_prompt: "You are Acme's friendly first responder.",
    greeting: "Sorry we missed you at Acme. What can we help you with?",
    voice_line: "Thanks for calling Acme.",
  },
}

Deno.test("handleCallEnded: EARLY HANGUP for a known caller -> claims + sends the GENERIC greeting (one text)", async () => {
  setEnv()
  const { state, restore } = installFetchStub(READY_SESSION)
  try {
    // A ring/greeting hangup: no RecordingDuration, no transcript, just CallStatus.
    const body = "CallSid=call-early-1&From=%2B18015551234&CallStatus=no-answer&CallDuration=0"
    await handleCallEnded(adminClient(), body, "application/x-www-form-urlencoded")
    // Exactly one send, and it is the generic personalized greeting.
    assertEquals(state.sentBodies.length, 1)
    assertEquals(state.sentBodies[0], READY_SESSION.fr_config.greeting)
    // The shared one-text guard was claimed exactly once for this CallSid.
    assertEquals(state.counts.get(`${TEXT_SENT_SCOPE}:call-early-1`), 1)
  } finally {
    restore()
    clearEnv()
  }
})

Deno.test("handleCallEnded: VM path ALREADY CLAIMED -> catch-all no-ops, NO generic pre-empt", async () => {
  setEnv()
  const { state, restore } = installFetchStub(READY_SESSION)
  try {
    // Pre-claim the CallSid, simulating the referencing transcribe path winning the
    // one-text slot BEFORE the deferred catch-all claim fires. The catch-all must
    // then send NOTHING (the referencing text already went).
    state.counts.set(`${TEXT_SENT_SCOPE}:call-vm-1`, 1)
    const body = "CallSid=call-vm-1&From=%2B18015551234&CallStatus=completed&CallDuration=9"
    await handleCallEnded(adminClient(), body, "application/x-www-form-urlencoded")
    assertEquals(state.sentBodies.length, 0) // no generic pre-empt
  } finally {
    restore()
    clearEnv()
  }
})

Deno.test("handleCallEnded: UNKNOWN caller (no ready session) -> NO text, NO claim", async () => {
  setEnv()
  const { state, restore } = installFetchStub(null) // no ready session
  try {
    const body = "CallSid=call-unknown-1&From=%2B18019998888&CallStatus=no-answer"
    await handleCallEnded(adminClient(), body, "application/x-www-form-urlencoded")
    assertEquals(state.sentBodies.length, 0)
    // Never claimed the guard for an unknown caller.
    assertEquals(state.counts.get(`${TEXT_SENT_SCOPE}:call-unknown-1`), undefined)
  } finally {
    restore()
    clearEnv()
  }
})

Deno.test("handleCallEnded: no caller number -> silent no-op (never texts a blank number)", async () => {
  setEnv()
  const { state, restore } = installFetchStub(READY_SESSION)
  try {
    const body = "CallSid=call-nofrom&From=&CallStatus=failed"
    await handleCallEnded(adminClient(), body, "application/x-www-form-urlencoded")
    assertEquals(state.sentBodies.length, 0)
  } finally {
    restore()
    clearEnv()
  }
})
