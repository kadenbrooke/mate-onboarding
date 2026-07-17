import { describe, it, expect } from "vitest"
import { materialsForCollected } from "./materials"

describe("materialsForCollected", () => {
  it("returns intake_form once basics present", () => {
    expect(
      materialsForCollected({ company: { name: "x" }, services: ["a"] })
    ).toContain("intake_form")
  })

  it("returns scope_lock once services + brand_voice present", () => {
    const keys = materialsForCollected({ services: ["a"], brand_voice: "warm" })
    expect(keys).toContain("scope_lock")
  })

  it("returns no intake_form without a company name", () => {
    expect(materialsForCollected({ services: ["a"] })).not.toContain("intake_form")
  })

  it("returns no scope_lock without brand_voice", () => {
    expect(materialsForCollected({ services: ["a"] })).not.toContain("scope_lock")
  })

  it("returns no keys for empty collected", () => {
    expect(materialsForCollected({})).toEqual([])
  })

  it("tolerates a null / non-object collected without throwing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(materialsForCollected(null as any)).toEqual([])
  })

  it("returns both keys when everything is present", () => {
    const keys = materialsForCollected({
      company: { name: "Acme" },
      services: ["paving"],
      brand_voice: "friendly",
    })
    expect(keys).toContain("intake_form")
    expect(keys).toContain("scope_lock")
  })

  it("ignores an empty services array", () => {
    expect(
      materialsForCollected({ company: { name: "x" }, services: [] })
    ).not.toContain("intake_form")
  })
})
