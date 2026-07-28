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

// The invite appended (in the EDGE layer, not fr-config.ts) to the spoken line so
// the caller is told they can text OR leave a message. Kept as one clause so a
// persona's voice_line stays the persona's; this is the demo-wide voicemail affordance.
export const VOICEMAIL_INVITE =
  " You can shoot us a text, or leave a quick message after the beep and we'll text you right back."

// Recording bounds. maxLength caps the message so a long ramble can't run up
// transcription cost; the beep signals "start talking". Env-overridable later
// without a code change if we want longer messages.
export const VOICEMAIL_MAX_LENGTH_SECONDS = 30

/**
 * The voicemail-with-transcription flow (Flow A). Speaks the personalized line +
 * the text-or-leave-a-message invite, then <Record>s the caller with transcription
 * on. Two callback URLs drive the "exactly one text" wiring downstream:
 *   - transcribeUrl  -> the transcribe callback (VM path: craft a message that
 *     references what they said). Telnyx-native attrs are `transcription` /
 *     `transcriptionCallback`; we ALSO emit the Twilio-compat `transcribe` /
 *     `transcribeCallback` aliases (harmless if ignored) so a naming mismatch
 *     can't silently drop transcription on the live call path.
 *   - actionUrl      -> fired when the <Record> ends (no-VM path: RecordingDuration
 *     ~0 => caller hung up without a message => send the generic text after the buffer).
 * Ends with <Hangup/> so the caller is not left on a dead line.
 *
 * NOTE both callback URLs already carry their `?k=` auth token (constructed by the
 * caller from SUPABASE_URL / DEMO_FUNCTIONS_BASE); they are emitted verbatim into
 * the XML attribute (XML-escaped), so `&` in the query string becomes `&amp;`.
 */
export function voicemailTexml(
  spokenLine: string,
  transcribeUrl: string,
  actionUrl: string,
  voice = DEMO_VOICE,
  maxLength = VOICEMAIL_MAX_LENGTH_SECONDS
): string {
  const say = `<Say voice="${esc(voice)}">${esc(spokenLine + VOICEMAIL_INVITE)}</Say>`
  // playBeep on, transcription on, both callback-attr spellings, action fires at end.
  const record =
    `<Record maxLength="${maxLength}" playBeep="true"` +
    ` transcribe="true" transcribeCallback="${esc(transcribeUrl)}"` +
    ` transcription="true" transcriptionCallback="${esc(transcribeUrl)}"` +
    ` action="${esc(actionUrl)}"/>`
  return `${HEAD}<Response>${say}${record}<Hangup/></Response>`
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
