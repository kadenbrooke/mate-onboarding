/**
 * Pure split logic for the client portal's two zones.
 *
 * - Live: capabilities that are functional NOW (status === "live").
 * - Under Construction: capabilities awaiting external registration or a build
 *   (status === "under_construction"), PLUS open build_requests (asks Mate
 *   logged that the team is scoping/building). Shown honestly with a reason.
 *
 * Build requests that are already shipped or declined are excluded — a shipped
 * request should surface as a real capability, and a declined one is closed.
 *
 * This module is pure and has NO Supabase/network dependency so it is unit
 * testable and reused verbatim by the portal API + UI.
 */

export interface Cap {
  capability_key: string
  label: string
  status: string
}

export interface Req {
  request_text: string
  mate_summary: string
  status: string
}

export interface LiveItem {
  capability_key: string
  label: string
  status: string
}

export interface UnderConstructionItem {
  capability_key: string
  label: string
  reason: string
}

// Build-request statuses that should NOT appear in Under Construction.
const CLOSED_REQUEST_STATUSES = new Set(["shipped", "declined"])

export function splitCapabilities(
  caps: Cap[],
  requests: Req[]
): { live: LiveItem[]; underConstruction: UnderConstructionItem[] } {
  const safeCaps = Array.isArray(caps) ? caps : []
  const safeRequests = Array.isArray(requests) ? requests : []

  const live: LiveItem[] = safeCaps
    .filter((c) => c.status === "live")
    .map((c) => ({
      capability_key: c.capability_key,
      label: c.label,
      status: c.status,
    }))

  const underConstruction: UnderConstructionItem[] = [
    ...safeCaps
      .filter((c) => c.status === "under_construction")
      .map((c) => ({
        capability_key: c.capability_key,
        label: c.label,
        reason: "awaiting build/registration",
      })),
    ...safeRequests
      .filter((r) => !CLOSED_REQUEST_STATUSES.has(r.status))
      .map((r) => ({
        capability_key: "req",
        // Prefer Mate's cleaned-up summary; fall back to the raw ask.
        label: (r.mate_summary && r.mate_summary.trim()) || r.request_text,
        reason: "requested, your team is on it",
      })),
  ]

  return { live, underConstruction }
}
