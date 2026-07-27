import { assertStringIncludes, assertEquals } from "jsr:@std/assert@1"
import {
  missedCallTexml,
  hangupTexml,
  messageTexml,
  emptyTexml,
  DEMO_VOICE,
} from "../_shared/texml.ts"

Deno.test("missedCallTexml: speaks a line then hangs up", () => {
  const xml = missedCallTexml("Sorry we missed you.")
  assertStringIncludes(xml, "<Response>")
  assertStringIncludes(xml, "<Say")
  assertStringIncludes(xml, "Sorry we missed you.")
  assertStringIncludes(xml, "<Hangup/>")
})

Deno.test("missedCallTexml: defaults to the Matthew neural voice (male)", () => {
  // Telnyx TeXML renders AWS Polly Matthew neural via `Polly.Matthew-Neural`
  // (Twilio-compatible Polly.<VoiceId>-Neural form). Without DEMO_VOICE set, this
  // is the default a real call hears.
  assertEquals(DEMO_VOICE, "Polly.Matthew-Neural")
  assertStringIncludes(missedCallTexml("hi"), '<Say voice="Polly.Matthew-Neural">')
})

Deno.test("missedCallTexml: escapes XML-special characters in the message", () => {
  const xml = missedCallTexml('Tom & "Jerry" <co>')
  assertStringIncludes(xml, "Tom &amp; &quot;Jerry&quot; &lt;co&gt;")
})

Deno.test("hangupTexml: bare hangup", () => {
  assertStringIncludes(hangupTexml(), "<Response><Hangup/></Response>")
})

Deno.test("messageTexml: wraps an SMS body", () => {
  assertStringIncludes(messageTexml("hi there"), "<Message>hi there</Message>")
})

Deno.test("emptyTexml: valid empty response", () => {
  assertStringIncludes(emptyTexml(), "<Response></Response>")
})

Deno.test("no em dash in default missed-call line", () => {
  assertEquals(missedCallTexml().includes("—"), false)
})
