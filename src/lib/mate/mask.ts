/**
 * Server-only-field handling for client-bound payloads.
 *
 * The EIN is collected by the RegistrationCard and stored in the session's
 * `collected` blob (server-side, service-role only). It must never travel back
 * to a browser in full: the session GET returns collected to whoever holds the
 * session UUID, and a leaked UUID must not leak a tax ID. So:
 *  - maskCollectedForClient: GET /api/session responses (last-4 mask; still a
 *    non-empty string so the client-side required-field gate stays satisfied).
 *  - stripServerOnly: Business Mate's getBusinessProfile tool output (removed
 *    entirely; the model has no reason to ever see it).
 * Pure, never throws.
 */

export function maskEin(v: unknown): string | null {
  if (typeof v !== "string") return null
  const digits = v.replace(/\D/g, "")
  if (digits.length < 4) return null
  return `*****${digits.slice(-4)}`
}

/** True when a value looks like our masked display form, never a real value. */
export function isMaskedValue(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("*****")
}

/**
 * Scrub EIN-shaped values from free text before it is persisted where a
 * browser can read it back (chat transcripts). Matches the canonical
 * XX-XXXXXXX form and bare word-bounded 9-digit runs.
 */
export function scrubEinPatterns(text: string): string {
  if (typeof text !== "string" || text === "") return text
  return text
    .replace(/\b\d{2}-\d{7}\b/g, "*****")
    .replace(/(?<!\d)\d{9}(?!\d)/g, "*****")
}

/** Copy of collected safe to return to the session's own browser. */
export function maskCollectedForClient(
  collected: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!collected || typeof collected !== "object" || Array.isArray(collected)) return {}
  const out: Record<string, unknown> = { ...collected }
  const masked = maskEin(out.ein)
  if (masked !== null) out.ein = masked
  else if ("ein" in out && typeof out.ein === "string") out.ein = "*****"
  else if ("ein" in out && typeof out.ein !== "string") delete out.ein
  return out
}

/** Copy of collected safe to hand the model (server-only fields removed). */
export function stripServerOnly(
  collected: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!collected || typeof collected !== "object" || Array.isArray(collected)) return {}
  const out: Record<string, unknown> = { ...collected }
  delete out.ein
  return out
}
