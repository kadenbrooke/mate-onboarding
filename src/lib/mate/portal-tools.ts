/**
 * Business Mate's fixed read-only tool layer. THE security boundary for
 * client-facing data access (spec decision: no RLS/JWT; code-scoped allowlist):
 *
 *  - Every query hard-codes .eq("contact_id", deps.contactId) from the
 *    SERVER-resolved session. The model picks tools; it NEVER supplies the
 *    filter and NEVER writes SQL.
 *  - All tools are read-only.
 *  - Server-only fields (EIN) are stripped before anything reaches the model.
 *  - Expanding Mate's knowledge = adding a function here, nothing else.
 *
 * The factory takes injected deps so unit tests prove the scoping without a
 * network. The route builds deps from the loaded session row.
 *
 * Type note: deps.supabase is typed as a minimal structural interface (not the
 * full SupabaseClient) so that the duck-typed fake in tests satisfies it without
 * requiring the real Supabase library. The real service-role client satisfies the
 * same interface at runtime.
 */
import { stripServerOnly } from "./mask"
import { agentRoster } from "../portal/capabilities"
import type { Cap, Req } from "../portal/capabilities"

/**
 * Structural interface for the Supabase queries this module makes. Typed as
 * `unknown` (i.e. accepted as any value) so that:
 *  - The real SupabaseClient (whose .limit() returns PostgrestFilterBuilder, not
 *    a plain Promise) satisfies it without complex generic gymnastics.
 *  - The test fake (which returns a plain Promise from .limit()) also satisfies it.
 * We deliberately avoid importing SupabaseClient here to keep this module free of
 * the Supabase dependency in test environments. The route casts the real client to
 * PortalSupabase when building deps; the factory only calls the fluent chain methods
 * it knows exist on both shapes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PortalSupabase = any

export interface PortalToolDeps {
  supabase: PortalSupabase
  /** Server-resolved contact id for THIS session. Null until onboarding done. */
  contactId: string | null
  collected: Record<string, unknown>
  capabilities: Cap[]
  requests: Req[]
}

const NO_DATA = {
  available: false as const,
  reason: "No data yet. Data appears once the assistant is live.",
}

export function buildPortalToolFns(deps: PortalToolDeps) {
  const { supabase, contactId, collected, capabilities, requests } = deps

  return {
    async getAgentStatus() {
      return {
        agents: agentRoster(capabilities, requests),
        openRequests: requests
          .filter((r) => r.status !== "shipped" && r.status !== "declined")
          .map((r) => ({ summary: r.mate_summary || r.request_text })),
      }
    },

    async getLeadStats() {
      if (!contactId) return NO_DATA
      const { data, error } = await supabase
        .from("interactions")
        .select("occurred_at, direction")
        .eq("contact_id", contactId)
        .limit(1000)
      if (error || !Array.isArray(data) || data.length === 0) return NO_DATA
      const now = Date.now()
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
      const last30 = data.filter(
        (r) =>
          now - new Date((r as { occurred_at: string }).occurred_at).getTime() <= THIRTY_DAYS
      ).length
      const latest = data
        .map((r) => (r as { occurred_at: string }).occurred_at)
        .sort()
        .at(-1)
      return {
        available: true,
        totalInteractions: data.length,
        last30Days: last30,
        latestAt: latest ?? null,
      }
    },

    async getRecentLeads() {
      if (!contactId) return NO_DATA
      const { data, error } = await supabase
        .from("interactions")
        .select("channel, direction, summary, occurred_at")
        .eq("contact_id", contactId)
        .order("occurred_at", { ascending: false })
        .limit(5)
      if (error || !Array.isArray(data) || data.length === 0) return NO_DATA
      return { available: true, recent: data }
    },

    async getBusinessProfile() {
      return { profile: stripServerOnly(collected) }
    },
  }
}
