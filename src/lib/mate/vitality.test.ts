import { describe, it, expect } from "vitest"
import { vitality, VITALITY_CHIPS } from "./vitality"

describe("vitality", () => {
  it("is 0% with nothing collected, all chips locked", () => {
    const v = vitality({})
    expect(v.percent).toBe(0)
    expect(v.chips.every((c) => !c.unlocked)).toBe(true)
  })
  it("unlocks 'Has your colors' when brand colors are confirmed", () => {
    const v = vitality({ brand_colors_confirmed: true })
    expect(v.chips.find((c) => c.key === "colors")?.unlocked).toBe(true)
  })
  it("unlocks 'Knows your trade' on services", () => {
    const v = vitality({ services: ["paving"] })
    expect(v.chips.find((c) => c.key === "trade")?.unlocked).toBe(true)
  })
  it("unlocks 'Can hear calls' only when BOTH phones are present", () => {
    expect(
      vitality({ current_phone: "801" }).chips.find((c) => c.key === "calls")?.unlocked
    ).toBe(false)
    expect(
      vitality({ current_phone: "801", lead_delivery_phone: "801" }).chips.find(
        (c) => c.key === "calls"
      )?.unlocked
    ).toBe(true)
  })
  it("unlocks 'Licensed to text' when the full 10DLC set is present", () => {
    const v = vitality({
      legal_business_name: "J&C Asphalt LLC",
      ein: "12-3456789",
      business_address: "123 Main St, Orem, UT 84058",
      entity_type: "LLC",
    })
    expect(v.chips.find((c) => c.key === "license")?.unlocked).toBe(true)
  })
  it("hits 100% when everything is collected", () => {
    const v = vitality({
      services: ["paving"],
      brand_voice: "friendly",
      current_phone: "801",
      lead_delivery_phone: "801",
      brand_colors_confirmed: true,
      legal_business_name: "x",
      ein: "123456789",
      business_address: "x",
      entity_type: "LLC",
      lead_channels: ["missed_calls"],
      website_editor_contact: "ben@x.com",
    })
    expect(v.percent).toBe(100)
    expect(v.chips.every((c) => c.unlocked)).toBe(true)
  })
  it("never throws on null/garbage", () => {
    expect(() => vitality(null)).not.toThrow()
    expect(vitality(null).percent).toBe(0)
  })
  it("exports the chip roster in display order", () => {
    expect(VITALITY_CHIPS.map((c) => c.key)).toEqual([
      "colors", "trade", "voice", "calls", "license",
    ])
  })
  it("keeps the colors chip locked for a non-boolean truthy value", () => {
    const v = vitality({ brand_colors_confirmed: "yes" })
    expect(v.chips.find((c) => c.key === "colors")?.unlocked).toBe(false)
  })
})
