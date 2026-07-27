// Prompt-injection hardening for the Instant First Responder Demo (HIGH FIX H2).
//
// The demo scrapes a PROSPECT-CONTROLLED website and feeds the extracted name +
// services straight into the persona system prompt that runs on every SMS reply.
// A hostile site can plant "ignore previous instructions..." text in those fields.
// We sanitize at the DEMO BOUNDARY (here + fr-config.ts) rather than in the shared
// sandbox-agent.ts, which the real onboarding flow also uses.
//
// Defenses (defense-in-depth; none is sufficient alone):
//   1. Strip newlines + control chars so injected text can't open a new "line" or
//      forge a role turn in the prompt.
//   2. Collapse the triple-angle delimiter tokens attackers use to close our fence.
//   3. Hard length caps so a wall of injected prose can't dominate the prompt.
// The delimiting itself (wrapping untrusted values in a labeled fence) is applied
// in fr-config.ts where the prompt is assembled.

/** Per-field length caps (chars). Untrusted data past these is truncated. */
export const NAME_MAX = 80
export const SERVICE_MAX = 60
export const MAX_SERVICES = 8

/**
 * Neutralize a single untrusted string for safe interpolation into a prompt:
 *   - drop control chars (incl. newlines/tabs) so it stays one line of DATA,
 *   - strip the triple-angle fence markers we use as delimiters so injected text
 *     can't close our fence early,
 *   - collapse whitespace runs, trim.
 * Length capping is applied by the field-specific helpers below.
 */
export function sanitizeField(raw: unknown): string {
  if (typeof raw !== "string") return ""
  // Remove ASCII control chars (code points < 0x20, and 0x7F DEL): newlines,
  // tabs, carriage returns, etc. Done by code point (not a control-char regex
  // literal) so the source stays clean and lint-safe.
  let stripped = ""
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    stripped += code < 0x20 || code === 0x7f ? " " : ch
  }
  return (
    stripped
      // Strip our fence markers so untrusted data can't forge/close the delimiter.
      .replace(/<<<+|>>>+/g, " ")
      // Collapse whitespace runs to single spaces.
      .replace(/\s+/g, " ")
      .trim()
  )
}

/** Sanitize + length-cap a business name (<= NAME_MAX). Empty -> "". */
export function sanitizeName(raw: unknown): string {
  return sanitizeField(raw).slice(0, NAME_MAX)
}

/**
 * Sanitize a services list: sanitize each entry, drop empties, cap each entry to
 * SERVICE_MAX chars, and keep at most MAX_SERVICES entries. Non-array -> [].
 */
export function sanitizeServices(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const s = sanitizeField(item).slice(0, SERVICE_MAX)
    if (s !== "") out.push(s)
    if (out.length >= MAX_SERVICES) break
  }
  return out
}
