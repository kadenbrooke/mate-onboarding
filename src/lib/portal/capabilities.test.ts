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
