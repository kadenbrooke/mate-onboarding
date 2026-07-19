import { describe, it, expect } from "vitest"
import { buildBrief, NOT_PROVIDED, type BriefGroup } from "./brief"

// Helpers to reach into the structured brief by group/field label.
function group(groups: BriefGroup[], title: string): BriefGroup {
  const g = groups.find((x) => x.title === title)
  if (!g) throw new Error(`missing group ${title}`)
  return g
}
function field(groups: BriefGroup[], title: string, label: string): string {
  const f = group(groups, title).fields.find((x) => x.label === label)
  if (!f) throw new Error(`missing field ${title} / ${label}`)
  return f.value
}

// A representative "fully filled" onboarding payload, mirroring the shapes the
// onboard cards write.
const FULL = {
  company: { name: "Acme Paving" },
  legal_business_name: "Acme Paving LLC",
  dba: "Acme Paving",
  business_address: "123 Main St, Orem UT",
  ein: "88-1234567",
  contact_name: "Jane Doe",
  contact_email: "jane@acme.com",
  second_contact: "Bob (office) 801-555-0100",
  current_phone: "+18015550111",
  forward_confirmed: true,
  lead_delivery_phone: "+18015550122",
  published: ["websites", "gbp", "signage"],
  services: ["Driveways", "Sealcoat", "Parking lots"],
  services_pricing: "driveways from $2,500",
  brand_voice: "warm, local, no jargon",
  qualify_criteria: "budget, timeline, project type, location",
  notes: "prefers morning calls",
  google_connected: true,
}

describe("buildBrief", () => {
  it("maps every First Responder field from a full payload", () => {
    const { groups } = buildBrief({
      id: "sess-1",
      status: "complete",
      website_url: "https://acmepaving.com",
      collected: FULL,
    })

    expect(field(groups, "Business", "Legal business name")).toBe("Acme Paving LLC")
    expect(field(groups, "Business", "DBA")).toBe("Acme Paving")
    expect(field(groups, "Business", "Business address")).toBe("123 Main St, Orem UT")
    expect(field(groups, "Business", "EIN")).toBe("88-1234567")

    expect(field(groups, "Contact", "Primary contact")).toBe("Jane Doe")
    expect(field(groups, "Contact", "Contact email")).toBe("jane@acme.com")
    expect(field(groups, "Contact", "Secondary contact")).toBe("Bob (office) 801-555-0100")

    expect(field(groups, "Phone & forwarding", "Current line (forward source)")).toBe("+18015550111")
    expect(field(groups, "Phone & forwarding", "Forwarding confirmed")).toBe("Yes")
    expect(field(groups, "Phone & forwarding", "Lead delivery number")).toBe("+18015550122")

    expect(field(groups, "Services", "Services offered")).toBe("Driveways, Sealcoat, Parking lots")
    expect(field(groups, "Services", "Rough pricing")).toBe("driveways from $2,500")

    expect(field(groups, "Voice & qualify", "Brand voice")).toBe("warm, local, no jargon")
    expect(field(groups, "Voice & qualify", "Qualify criteria")).toBe("budget, timeline, project type, location")
    expect(field(groups, "Voice & qualify", "Notes")).toBe("prefers morning calls")

    expect(field(groups, "Integrations", "Google connected")).toBe("Yes")
    expect(field(groups, "Integrations", "Website")).toBe("https://acmepaving.com")
  })

  it("maps published channel tokens to human labels", () => {
    const { groups } = buildBrief({ collected: FULL })
    expect(field(groups, "Phone & forwarding", "Published on")).toBe(
      "Website(s), Google Business, Vehicle / signage"
    )
  })

  it("falls back to the raw token for an unknown channel", () => {
    const { groups } = buildBrief({ collected: { published: ["billboards"] } })
    expect(field(groups, "Phone & forwarding", "Published on")).toBe("billboards")
  })

  it("shows NOT_PROVIDED for every missing optional field", () => {
    const { groups } = buildBrief({ collected: {} })
    expect(field(groups, "Business", "EIN")).toBe(NOT_PROVIDED)
    expect(field(groups, "Contact", "Primary contact")).toBe(NOT_PROVIDED)
    expect(field(groups, "Services", "Services offered")).toBe(NOT_PROVIDED)
    expect(field(groups, "Phone & forwarding", "Published on")).toBe(NOT_PROVIDED)
    // A missing boolean is NOT_PROVIDED, not a fabricated "No".
    expect(field(groups, "Phone & forwarding", "Forwarding confirmed")).toBe(NOT_PROVIDED)
    expect(field(groups, "Integrations", "Google connected")).toBe(NOT_PROVIDED)
  })

  it("renders false booleans as No, never NOT_PROVIDED", () => {
    const { groups } = buildBrief({
      collected: { forward_confirmed: false, google_connected: false },
    })
    expect(field(groups, "Phone & forwarding", "Forwarding confirmed")).toBe("No")
    expect(field(groups, "Integrations", "Google connected")).toBe("No")
  })

  it("ignores empty-string values (treats them as not provided)", () => {
    const { groups } = buildBrief({ collected: { legal_business_name: "   " } })
    expect(field(groups, "Business", "Legal business name")).toBe(NOT_PROVIDED)
  })

  it("never fabricates: an empty services array is NOT_PROVIDED", () => {
    const { groups } = buildBrief({ collected: { services: [] } })
    expect(field(groups, "Services", "Services offered")).toBe(NOT_PROVIDED)
  })

  it("derives the heading from company name, then legal name, then mate_name", () => {
    expect(buildBrief({ collected: { company: { name: "Acme" } } }).heading).toBe("Acme")
    expect(buildBrief({ collected: { legal_business_name: "Acme LLC" } }).heading).toBe("Acme LLC")
    expect(buildBrief({ mate_name: "Acme Mate", collected: {} }).heading).toBe("Acme Mate")
    expect(buildBrief({ collected: {} }).heading).toBe("Handoff brief")
  })

  it("tolerates a null / non-object collected without throwing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brief = buildBrief({ collected: null as any })
    expect(field(brief.groups, "Business", "EIN")).toBe(NOT_PROVIDED)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => buildBrief({ collected: "garbage" as any })).not.toThrow()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => buildBrief({ collected: ["array"] as any })).not.toThrow()
  })

  it("produces a copy block containing the mapped values", () => {
    const { copyText } = buildBrief({
      id: "sess-1",
      status: "complete",
      website_url: "https://acmepaving.com",
      collected: FULL,
    })
    expect(copyText).toContain("FIRST RESPONDER BUILD BRIEF: Acme Paving")
    expect(copyText).toContain("Session: sess-1")
    expect(copyText).toContain("Legal business name: Acme Paving LLC")
    expect(copyText).toContain("Lead delivery number: +18015550122")
    expect(copyText).toContain("Services offered: Driveways, Sealcoat, Parking lots")
    expect(copyText).toContain("Published on: Website(s), Google Business, Vehicle / signage")
    // No em dashes anywhere in the copy block (brand rule).
    expect(copyText).not.toContain("—")
  })
})

describe("phase 2 brief groups", () => {
  const session = {
    id: "s1",
    collected: {
      legal_business_name: "J&C Asphalt LLC",
      ein: "123456789",
      business_address: "123 Main St, Orem, UT 84058",
      entity_type: "LLC",
      lead_channels: ["missed_calls", "web_form"],
      leads_per_week: "12",
      avg_job_value: "4800",
      website_editor_name: "Ben",
      website_editor_contact: "ben@example.com",
      website_can_edit: "yes",
    },
  }
  const brief = buildBrief(session)
  const flat = brief.copyText

  it("renders a 10DLC Registration group with entity type", () => {
    expect(flat).toContain("## 10DLC registration")
    expect(flat).toContain("Entity type: LLC")
    expect(flat).toContain("EIN: 123456789")
  })
  it("renders lead channels with human labels", () => {
    expect(flat).toContain("Missed phone calls")
    expect(flat).toContain("Website form")
  })
  it("renders the website editor + can-edit flag (opt-in compliance)", () => {
    expect(flat).toContain("Website editor: Ben")
    expect(flat).toContain("ben@example.com")
    expect(flat).toContain("Client can edit site: yes")
  })
  it("renders the ROI baseline numbers", () => {
    expect(flat).toContain("Leads per week: 12")
    expect(flat).toContain("Average job value: 4800")
  })
  it("missing phase-2 fields render the sentinel, never fabricated", () => {
    const empty = buildBrief({ id: "s2", collected: {} })
    expect(empty.copyText).toContain("Entity type: (not provided)")
  })
})
