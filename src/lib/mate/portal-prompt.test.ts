import { describe, it, expect } from "vitest"
import { matePortalPrompt } from "./portal-prompt"

describe("matePortalPrompt", () => {
  const p = matePortalPrompt("Jack", "J&C Asphalt", "first_responder is live.")
  it("keeps the white-label rule", () => {
    expect(p).toContain("Never mention who built you")
  })
  it("keeps the capability hard rule (requestBuild)", () => {
    expect(p).toContain("requestBuild")
  })
  it("instructs real-data-only answers via tools", () => {
    expect(p).toContain("getLeadStats")
    expect(p).toContain("never make up")
  })
  it("no em dashes", () => {
    expect(p).not.toContain("—")
  })
})
