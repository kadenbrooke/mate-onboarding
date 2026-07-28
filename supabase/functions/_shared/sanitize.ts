// Prompt-injection hardening for the demo edge functions (Deno mirror of the app's
// src/lib/demo/sanitize.ts). Edge functions run on Deno and cannot import app src/,
// so this is the deliberate small mirror (same decision as db.ts / portkey.ts).
//
// Used to neutralize the VOICEMAIL TRANSCRIPT before it flows into the reply model.
// A voicemail transcript is caller-controlled free text and is fenced + sanitized
// exactly like the scraped name/services are in fr-config.ts (defense in depth):
//   1. strip control chars / newlines so injected text can't forge a role turn,
//   2. collapse our <<< >>> fence markers so it can't close the fence early,
//   3. collapse whitespace, trim,
//   4. hard length cap so a long ramble can't dominate the prompt.

/** Max chars kept from a voicemail transcript before it enters the prompt. */
export const TRANSCRIPT_MAX = 600

/**
 * Neutralize a single untrusted string for safe interpolation into a prompt:
 *   - drop ASCII control chars (incl. newlines/tabs) so it stays one line of DATA,
 *   - strip the triple-angle fence markers used as delimiters,
 *   - collapse whitespace runs, trim.
 * Length capping is applied by the field-specific helper below.
 */
export function sanitizeField(raw: unknown): string {
  if (typeof raw !== "string") return ""
  let stripped = ""
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    stripped += code < 0x20 || code === 0x7f ? " " : ch
  }
  return stripped
    .replace(/<<<+|>>>+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Sanitize + length-cap a voicemail transcript (<= TRANSCRIPT_MAX). Empty -> "". */
export function sanitizeTranscript(raw: unknown): string {
  return sanitizeField(raw).slice(0, TRANSCRIPT_MAX)
}
