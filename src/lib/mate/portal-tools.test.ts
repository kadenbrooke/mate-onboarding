import { describe, it, expect } from "vitest"
import { buildPortalToolFns } from "./portal-tools"

interface Row { contact_id: string; channel: string; direction: string; summary: string; occurred_at: string }

// Minimal fake of the two query shapes the tools use.
// Uses .limit() at the end of every chain so both paths terminate in a real promise
// (consistent with tool code that always ends with .limit(n)).
function fakeSupabase(rows: Row[]) {
  return {
    from(_table: string) {
      return {
        select(_cols?: string) { return this },
        eq(_col: string, val: string) {
          // Every query MUST filter by contact_id; the fake enforces it by
          // only ever returning rows matching the eq value.
          const filtered = rows.filter((r) => r.contact_id === val)
          return {
            order(_col: string, _opts?: { ascending?: boolean }) { return this },
            limit(_n: number): Promise<{ data: Row[]; error: null }> {
              return Promise.resolve({ data: filtered, error: null })
            },
          }
        },
      }
    },
  }
}

const ROWS: Row[] = [
  { contact_id: "A", channel: "sms", direction: "inbound", summary: "lead one", occurred_at: "2026-07-01T00:00:00Z" },
  { contact_id: "B", channel: "sms", direction: "inbound", summary: "OTHER CLIENT", occurred_at: "2026-07-02T00:00:00Z" },
]

describe("portal tools scoping", () => {
  it("getRecentLeads only returns the bound contact's rows", async () => {
    const tools = buildPortalToolFns({
      supabase: fakeSupabase(ROWS) as never,
      contactId: "A",
      collected: {},
      capabilities: [],
      requests: [],
    })
    const out = await tools.getRecentLeads()
    expect(JSON.stringify(out)).toContain("lead one")
    expect(JSON.stringify(out)).not.toContain("OTHER CLIENT")
  })
  it("tools degrade honestly with no contact bound", async () => {
    const tools = buildPortalToolFns({
      supabase: fakeSupabase(ROWS) as never,
      contactId: null,
      collected: {},
      capabilities: [],
      requests: [],
    })
    const stats = await tools.getLeadStats()
    expect(stats).toEqual({ available: false, reason: "No data yet. Data appears once the assistant is live." })
  })
  it("getBusinessProfile strips server-only fields (EIN)", async () => {
    const tools = buildPortalToolFns({
      supabase: fakeSupabase([]) as never,
      contactId: "A",
      collected: { ein: "123456789", brand_voice: "warm" },
      capabilities: [],
      requests: [],
    })
    const profile = await tools.getBusinessProfile()
    expect(JSON.stringify(profile)).not.toContain("123456789")
    expect(JSON.stringify(profile)).toContain("warm")
  })
  it("getLeadStats happy path: scoped counts + latest timestamp", async () => {
    const tools = buildPortalToolFns({
      supabase: fakeSupabase(ROWS) as never,
      contactId: "A",
      collected: {},
      capabilities: [],
      requests: [],
    })
    const stats = (await tools.getLeadStats()) as {
      available: boolean
      totalInteractions: number
      latestAt: string | null
    }
    expect(stats.available).toBe(true)
    expect(stats.totalInteractions).toBe(1) // contact B's row excluded
    expect(stats.latestAt).toBe("2026-07-01T00:00:00Z")
  })
  it("getAgentStatus reflects the roster", async () => {
    const tools = buildPortalToolFns({
      supabase: fakeSupabase([]) as never,
      contactId: "A",
      collected: {},
      capabilities: [{ capability_key: "first_responder", label: "FR", status: "live" }],
      requests: [],
    })
    const status = await tools.getAgentStatus()
    expect(JSON.stringify(status)).toContain('"first_responder"')
    expect(JSON.stringify(status)).toContain('"live"')
  })
})
