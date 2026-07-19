import { describe, it, expect } from "vitest"
import { splitCapabilities } from "./capabilities"

describe("splitCapabilities", () => {
  it("routes live vs under_construction and folds build_requests into UC", () => {
    const { live, underConstruction } = splitCapabilities(
      [
        { capability_key: "gbp", label: "Google Reviews", status: "live" },
        { capability_key: "fr_sms", label: "Text-back", status: "under_construction" },
      ],
      [{ request_text: "add Spanish", mate_summary: "Spanish replies", status: "new" }]
    )
    expect(live.map((l) => l.capability_key)).toEqual(["gbp"])
    expect(underConstruction.length).toBe(2) // fr_sms + the build request
  })

  it("excludes shipped and declined build_requests from Under Construction", () => {
    const { live, underConstruction } = splitCapabilities(
      [{ capability_key: "gbp", label: "Google Reviews", status: "live" }],
      [
        { request_text: "add Spanish", mate_summary: "Spanish replies", status: "new" },
        { request_text: "shipped thing", mate_summary: "Already live", status: "shipped" },
        { request_text: "declined thing", mate_summary: "Not doing", status: "declined" },
      ]
    )
    // Only the "new" request folds into UC; shipped + declined are excluded.
    expect(underConstruction.length).toBe(1)
    expect(underConstruction[0].label).toBe("Spanish replies")
    expect(live.map((l) => l.capability_key)).toEqual(["gbp"])
  })

  it("keeps a build request that lacks a mate_summary, falling back to request_text", () => {
    const { underConstruction } = splitCapabilities(
      [],
      [{ request_text: "raw ask text", mate_summary: "", status: "scoping" }]
    )
    expect(underConstruction.length).toBe(1)
    expect(underConstruction[0].label).toBe("raw ask text")
  })

  it("emits no em dashes in reason strings", () => {
    const { underConstruction } = splitCapabilities(
      [{ capability_key: "fr_sms", label: "Text-back", status: "under_construction" }],
      [{ request_text: "x", mate_summary: "y", status: "new" }]
    )
    for (const item of underConstruction) {
      expect(item.reason).not.toContain("—") // em dash
      expect(item.reason).not.toContain("–") // en dash
    }
  })
})

import { agentRoster, AUTO_MATE_5 } from "./capabilities"

describe("agentRoster", () => {
  it("always returns exactly the Auto Mate 5, in order", () => {
    const roster = agentRoster([], [])
    expect(roster.map((a) => a.key)).toEqual([
      "first_responder", "cultivator", "reactivator", "reputation_builder", "command_center",
    ])
    expect(roster.every((a) => a.status === "coming_soon")).toBe(true)
  })
  it("maps a live capability onto its agent", () => {
    const roster = agentRoster(
      [{ capability_key: "first_responder", label: "First Responder", status: "live" }],
      []
    )
    expect(roster[0].status).toBe("live")
  })
  it("maps a demo capability", () => {
    const roster = agentRoster(
      [{ capability_key: "first_responder", label: "x", status: "demo" }],
      []
    )
    expect(roster[0].status).toBe("demo")
  })
  it("surfaces a pending-license reason on the First Responder when under construction", () => {
    const roster = agentRoster(
      [{ capability_key: "first_responder", label: "x", status: "under_construction" }],
      []
    )
    expect(roster[0].status).toBe("coming_soon")
    expect(roster[0].reason).toBeTruthy()
  })
})

describe("agentRoster capability aliases", () => {
  it("maps the Phase 1 seed key first_responder_sms onto the First Responder card", () => {
    const roster = agentRoster(
      [{ capability_key: "first_responder_sms", label: "Missed-call text-back", status: "under_construction" }],
      []
    )
    expect(roster[0].status).toBe("coming_soon")
    expect(roster[0].reason).toBe("License pending carrier approval")
  })
  it("a live first_responder_sms lights the card up", () => {
    const roster = agentRoster(
      [{ capability_key: "first_responder_sms", label: "x", status: "live" }],
      []
    )
    expect(roster[0].status).toBe("live")
  })
  it("gbp_reviews does NOT claim the Reputation Builder", () => {
    const roster = agentRoster(
      [{ capability_key: "gbp_reviews", label: "x", status: "live" }],
      []
    )
    expect(roster[3].status).toBe("coming_soon")
  })
})

describe("demo card reason", () => {
  it("demo cards carry the honest license-pending invite", () => {
    const roster = agentRoster(
      [{ capability_key: "first_responder_sms", label: "x", status: "demo" }],
      []
    )
    expect(roster[0].status).toBe("demo")
    expect(roster[0].reason).toContain("Try the demo")
  })
})
