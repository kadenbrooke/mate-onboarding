/**
 * The concierge's default display name, derived from the owner's business.
 * "{Business} Mate" (e.g. "J&C Asphalt Paving Mate"). When we have no business
 * name yet (research bot-walled, or not run), fall back to the bare "Mate" so
 * the UI always has something coherent to show.
 *
 * This is the default only. The owner may rename it, and a customized name
 * must never be overwritten by this default (see the research route).
 */
export function defaultMateName(business: string): string {
  const b = business.trim()
  return b ? `${b} Mate` : "Mate"
}
