// Telnyx TeXML builders for the Instant First Responder Demo.
//
// TeXML is Telnyx's Twilio-TwiML-compatible dialect. Ported from the ben-barlow
// lead-capture _shared/twiml.ts (which used <Dial> to forward). Here we do NOT
// forward: the demo number never answers. It speaks a short "sorry we missed you"
// message (~3s) then hangs up, and the text-back is fired separately by the
// webhook via the Telnyx Messaging API.

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>'

// The default TeXML <Say> voice for the demo. Telnyx TeXML is Twilio-compatible,
// so a neural Amazon Polly voice is prescribed as `Polly.<VoiceId>-Neural`
// (verified against Telnyx TeXML <Say> docs — this is the value that renders in
// Matthew's neural voice on a real call; the plain REST TTS id `AWS.Polly.
// Matthew-Neural` is a different surface). Overridable via DEMO_VOICE so it's a
// one-env-var change later without touching code.
export const DEMO_VOICE = Deno.env.get("DEMO_VOICE") || "Polly.Matthew-Neural"

/** Escape XML-special characters in spoken text. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * The missed-call flow: a short spoken line then hang up. The message is kept to
 * one short sentence so it lands in about 3 seconds. Voice defaults to DEMO_VOICE
 * (AWS Polly Matthew, neural — a warm male voice the founder will hear on a call).
 */
export function missedCallTexml(
  message = "Sorry we missed you. We will text you right back.",
  voice = DEMO_VOICE
): string {
  return `${HEAD}<Response><Say voice="${esc(voice)}">${esc(message)}</Say><Hangup/></Response>`
}

/** A bare hangup, used when we do not want to speak (e.g. unknown caller). */
export function hangupTexml(): string {
  return `${HEAD}<Response><Hangup/></Response>`
}

/** A TeXML SMS reply body (used to answer inbound SMS webhooks synchronously). */
export function messageTexml(message: string): string {
  return `${HEAD}<Response><Message>${esc(message)}</Message></Response>`
}

/** An empty TeXML response (acknowledge with no action). */
export function emptyTexml(): string {
  return `${HEAD}<Response></Response>`
}
