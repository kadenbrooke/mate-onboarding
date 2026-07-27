// Telnyx TeXML builders for the Instant First Responder Demo.
//
// TeXML is Telnyx's Twilio-TwiML-compatible dialect. Ported from the ben-barlow
// lead-capture _shared/twiml.ts (which used <Dial> to forward). Here we do NOT
// forward: the demo number never answers. It speaks a short "sorry we missed you"
// message (~3s) then hangs up, and the text-back is fired separately by the
// webhook via the Telnyx Messaging API.

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>'

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
 * one short sentence so it lands in about 3 seconds. Voice defaults to a neutral
 * Telnyx TeXML voice.
 */
export function missedCallTexml(
  message = "Sorry we missed you. We will text you right back.",
  voice = "Polly.Joanna"
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
