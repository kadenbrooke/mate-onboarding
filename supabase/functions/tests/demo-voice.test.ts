import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1"
import { handleVoice } from "../demo-voice/index.ts"

// These exercise the request-routing + TeXML emission of the voice webhook WITHOUT
// live Telnyx/Supabase: the branches under test resolve before any DB/Messaging I/O.
//
// Auth: no TELNYX_PUBLIC_KEY + not prod => verifyTelnyx dev-skips (returns true),
// and no DEMO_VOICE_TOKEN => token path unavailable, so the dev-skip is what lets
// these through. We clear prod markers so that holds.

function clearAuthEnv() {
  Deno.env.delete("DENO_DEPLOYMENT_ID")
  Deno.env.delete("DEMO_ENV")
  Deno.env.delete("TELNYX_PUBLIC_KEY")
  Deno.env.delete("DEMO_VOICE_TOKEN")
  Deno.env.delete("DEMO_TRANSCRIBE_TOKEN")
  Deno.env.delete("DEMO_FUNCTIONS_BASE")
  Deno.env.delete("SUPABASE_URL")
}

function callPost(body: string): Request {
  return new Request("https://x.supabase.co/functions/v1/demo-voice", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
}

Deno.test("initial call (no caller ID): returns voicemail TeXML (Say+invite+Record), NO text sent", async () => {
  clearAuthEnv()
  Deno.env.set("DEMO_FUNCTIONS_BASE", "https://fn.example.com")
  Deno.env.set("DEMO_TRANSCRIBE_TOKEN", "ttok")
  Deno.env.set("DEMO_VOICE_TOKEN", "vtok")
  // Withheld caller ID -> generic-line branch, which returns BEFORE any Supabase call.
  const res = await handleVoice(callPost("From=&To=%2B13854409744&CallSid=c1"))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get("Content-Type"), "text/xml")
  const xml = await res.text()
  // Voicemail flow: Say (line + invite) + Record + Hangup. Crucially NO <Message>
  // verb: the text-back is NOT fired from the call webhook anymore (Flow A).
  assertStringIncludes(xml, "<Say")
  assertStringIncludes(xml, "leave a quick message after the beep")
  assertStringIncludes(xml, "<Record")
  assertStringIncludes(xml, "<Hangup/>")
  assertEquals(xml.includes("<Message"), false)
  // The Record verb points at demo-transcribe (VM) and demo-voice (action), both
  // carrying their auth token.
  assertStringIncludes(xml, "demo-transcribe?k=ttok")
  assertStringIncludes(xml, "action=\"https://fn.example.com/demo-voice?k=vtok\"")
  assertStringIncludes(xml, 'transcribe="true"')
  clearAuthEnv()
})

Deno.test("initial call TeXML has no em dash", async () => {
  clearAuthEnv()
  const res = await handleVoice(callPost("From=&CallSid=c2"))
  const xml = await res.text()
  assertEquals(xml.includes("—"), false)
  clearAuthEnv()
})

Deno.test("routing: a body carrying RecordingDuration is the action callback (200 ack, not TeXML)", async () => {
  clearAuthEnv()
  // adminClient() needs a URL; the detached handler for dur>threshold early-returns
  // before any RPC, so a dummy URL is enough to prove the routing without live I/O.
  Deno.env.set("SUPABASE_URL", "https://dummy.supabase.co")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "dummy")
  // A recording-ended callback with a REAL message (duration above the no-message
  // threshold) -> the handler ACKs with 200 and does NOT emit TeXML. It does NOT
  // send (the VM path owns a real message): dur=12 => early return, no RPC.
  const body = "CallSid=c3&From=%2B18015551234&RecordingDuration=12&RecordingUrl=https%3A%2F%2Fr"
  const res = await handleVoice(callPost(body))
  assertEquals(res.status, 200)
  const text = await res.text()
  // Not TeXML: the action callback is acknowledged, the call already hung up.
  assertEquals(text.includes("<Response>"), false)
  assertEquals(text, "ok")
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY")
  clearAuthEnv()
})

Deno.test("auth: rejected in prod with no token + no signature", async () => {
  clearAuthEnv()
  Deno.env.set("DENO_DEPLOYMENT_ID", "deploy-xyz") // simulate prod
  const res = await handleVoice(callPost("From=&CallSid=c4"))
  assertEquals(res.status, 401)
  clearAuthEnv()
})
