import { describe, it, expect } from "vitest"
import { applyToolResult, toolSchemas, UI_CARD_TOOLS } from "./tools"

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

describe("phase 2 card tools", () => {
  it("declares the three card-trigger tools", () => {
    expect(toolSchemas.showColorCard).toBeDefined()
    expect(toolSchemas.showRegistrationCard).toBeDefined()
    expect(toolSchemas.showChannelsCard).toBeDefined()
  })
  it("UI_CARD_TOOLS lists exactly the card triggers", () => {
    expect([...UI_CARD_TOOLS].sort()).toEqual([
      "showChannelsCard", "showColorCard", "showRegistrationCard",
    ])
  })
  it("card triggers do NOT mutate collected", () => {
    const before = { services: ["x"] }
    expect(applyToolResult(before, { tool: "showColorCard", args: {} })).toEqual(before)
  })
})
