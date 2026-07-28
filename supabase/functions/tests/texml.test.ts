import { assertStringIncludes, assertEquals } from "jsr:@std/assert@1"
import {
  missedCallTexml,
  hangupTexml,
  messageTexml,
  emptyTexml,
  voicemailTexml,
  VOICEMAIL_INVITE,
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

// --- Voicemail-with-transcription flow (Flow A). ---

Deno.test("voicemailTexml: Say (line + invite) then Record then Hangup", () => {
  const xml = voicemailTexml(
    "Hey, thanks for calling Acme! Sorry we missed you.",
    "https://x.supabase.co/functions/v1/demo-transcribe?k=T",
    "https://x.supabase.co/functions/v1/demo-voice?k=V"
  )
  // Say carries BOTH the personalized spoken line and the appended invite.
  assertStringIncludes(xml, "Hey, thanks for calling Acme! Sorry we missed you.")
  assertStringIncludes(xml, "leave a quick message after the beep")
  // Ordered: Say before Record before Hangup.
  const sayAt = xml.indexOf("<Say")
  const recAt = xml.indexOf("<Record")
  const hangAt = xml.indexOf("<Hangup")
  assertEquals(sayAt < recAt && recAt < hangAt, true)
})

Deno.test("voicemailTexml: Record enables transcription + beep + maxLength", () => {
  const xml = voicemailTexml("hi", "https://f/demo-transcribe?k=T", "https://f/demo-voice?k=V")
  assertStringIncludes(xml, 'playBeep="true"')
  assertStringIncludes(xml, 'maxLength="30"')
  // Both attribute spellings present (Telnyx-native + Twilio-compat) so a naming
  // mismatch can't silently drop transcription on the live call path.
  assertStringIncludes(xml, 'transcribe="true"')
  assertStringIncludes(xml, 'transcription="true"')
})

Deno.test("voicemailTexml: emits the transcribe callback URL with its token (XML-escaped)", () => {
  const xml = voicemailTexml(
    "hi",
    "https://f/demo-transcribe?k=tok123&x=1",
    "https://f/demo-voice?k=vtok"
  )
  // The `&` in the query string must be XML-escaped inside the attribute value.
  assertStringIncludes(xml, "demo-transcribe?k=tok123&amp;x=1")
  assertStringIncludes(xml, 'action="https://f/demo-voice?k=vtok"')
})

Deno.test("voicemailTexml: uses the Matthew neural voice by default", () => {
  assertStringIncludes(
    voicemailTexml("hi", "https://f/t?k=1", "https://f/a?k=2"),
    '<Say voice="Polly.Matthew-Neural">'
  )
})

Deno.test("voicemailTexml: invite constant has no em dash", () => {
  assertEquals(VOICEMAIL_INVITE.includes("—"), false)
  assertEquals(
    voicemailTexml("hi", "https://f/t?k=1", "https://f/a?k=2").includes("—"),
    false
  )
})
