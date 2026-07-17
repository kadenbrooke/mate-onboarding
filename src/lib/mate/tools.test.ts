import { describe, it, expect } from "vitest"
import { applyToolResult } from "./tools"

describe("applyToolResult", () => {
  it("merges saveField into collected", () => {
    const next = applyToolResult({ services: ["driveway"] }, { tool: "saveField", args: { key: "lead_delivery_phone", value: "+18019414398" } })
    expect(next.lead_delivery_phone).toBe("+18019414398")
    expect(next.services).toEqual(["driveway"])
  })
  it("confirmServices overwrites the services array", () => {
    const next = applyToolResult({}, { tool: "confirmServices", args: { services: ["sealcoat", "repair"] } })
    expect(next.services).toEqual(["sealcoat", "repair"])
  })
})
