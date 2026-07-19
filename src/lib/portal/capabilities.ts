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

// ---- Phase 2: the Auto Mate 5 agent roster for the Command Center ----

export type AgentStatus = "live" | "demo" | "coming_soon"

export interface AgentCard {
  key: string
  label: string
  status: AgentStatus
  /** Honest reason line for coming_soon (never fabricated). */
  reason: string | null
}

/** The five product agents, display order fixed. capability_key convention:
 *  a client_capabilities row whose capability_key matches an agent key sets
 *  that agent's card status. */
export const AUTO_MATE_5: { key: string; label: string }[] = [
  { key: "first_responder", label: "First Responder" },
  { key: "cultivator", label: "Cultivator" },
  { key: "reactivator", label: "Reactivator" },
  { key: "reputation_builder", label: "Reputation Builder" },
  { key: "command_center", label: "Command Center" },
]

// Legacy capability keys (the Phase 1 seed in /api/mate/complete writes
// `first_responder_sms`) map onto their product agent so seeded rows light up
// the roster. Without this, a seeded First Responder never matches its card:
// the license-pending reason and any later live flip would be invisible.
// gbp_reviews is deliberately unmapped: a Google connection alone must not
// claim the Reputation Builder agent is live.
const CAPABILITY_ALIASES: Record<string, string> = {
  first_responder_sms: "first_responder",
}

// NOTE: `requests` is currently UNUSED (open build requests surface via the
// portal's buildRequests payload + Business Mate's getAgentStatus instead).
// The two call sites pass differently-encoded statuses (raw DB enum vs the
// portal route's friendly labels) — if this ever starts consuming requests,
// normalize the encoding at the call sites first.
export function agentRoster(caps: Cap[], requests: Req[]): AgentCard[] {
  const safeCaps = Array.isArray(caps) ? caps : []
  const byKey = new Map(
    safeCaps.map((c) => [
      CAPABILITY_ALIASES[c.capability_key] ?? c.capability_key,
      c,
    ])
  )

  return AUTO_MATE_5.map(({ key, label }) => {
    const cap = byKey.get(key)
    if (cap?.status === "live") return { key, label, status: "live" as const, reason: null }
    if (cap?.status === "demo") return { key, label, status: "demo" as const, reason: null }
    return {
      key,
      label,
      status: "coming_soon" as const,
      reason:
        key === "first_responder" && cap?.status === "under_construction"
          ? "License pending carrier approval"
          : cap?.status === "under_construction"
            ? "In progress. Your team is building this."
            : "Not built yet. Ask your Mate to get it on the list.",
    }
  })
}
