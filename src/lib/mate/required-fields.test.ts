import { describe, it, expect } from "vitest"
import {
  REQUIRED_KEYS,
  isFieldDone,
  allRequiredPresent,
} from "./required-fields"

const complete = {
  services: ["Paving", "Sealcoating"],
  brand_voice: "Friendly and casual",
  current_phone: "+13850000000",
  lead_delivery_phone: "+13850000001",
  brand_colors_confirmed: true,
  legal_business_name: "J&C Asphalt LLC",
  ein: "123456789",
  business_address: "123 Main St, Orem, UT 84058",
  entity_type: "LLC",
  lead_channels: ["missed_calls"],
  website_editor_contact: "ben@example.com",
}

describe("required-fields", () => {
  it("exposes the eleven gate fields", () => {
    expect([...REQUIRED_KEYS]).toEqual([
      "services",
      "brand_voice",
      "current_phone",
      "lead_delivery_phone",
      "brand_colors_confirmed",
      "legal_business_name",
      "ein",
      "business_address",
      "entity_type",
      "lead_channels",
      "website_editor_contact",
    ])
  })

  it("allRequiredPresent is true only when all eleven are present", () => {
    expect(allRequiredPresent(complete)).toBe(true)
  })

  it("returns false for null/undefined/non-object", () => {
    expect(allRequiredPresent(null)).toBe(false)
    expect(allRequiredPresent(undefined)).toBe(false)
    // @ts-expect-error exercising the runtime guard
    expect(allRequiredPresent("nope")).toBe(false)
  })

  it("returns false when any single required field is missing", () => {
    for (const key of REQUIRED_KEYS) {
      const partial = { ...complete }
      delete (partial as Record<string, unknown>)[key]
      expect(allRequiredPresent(partial)).toBe(false)
    }
  })

  it("treats empty services array as not done", () => {
    expect(isFieldDone("services", { ...complete, services: [] })).toBe(false)
    expect(allRequiredPresent({ ...complete, services: [] })).toBe(false)
  })

  it("treats whitespace-only strings as not done", () => {
    expect(isFieldDone("brand_voice", { brand_voice: "   " })).toBe(false)
    expect(isFieldDone("current_phone", { current_phone: "  " })).toBe(false)
    expect(
      isFieldDone("lead_delivery_phone", { lead_delivery_phone: "" })
    ).toBe(false)
  })

  it("ignores non-string phone/voice values", () => {
    // current_phone is typed `unknown` in RequiredCollected, so a number is a
    // legal input here; the runtime typeof guard is what rejects it.
    expect(isFieldDone("current_phone", { current_phone: 3850000000 })).toBe(
      false
    )
  })
})

describe("phase 2 required set", () => {
  const full = {
    services: ["paving"],
    brand_voice: "friendly",
    current_phone: "8015551234",
    lead_delivery_phone: "8015551234",
    brand_colors_confirmed: true,
    legal_business_name: "J&C Asphalt LLC",
    ein: "123456789",
    business_address: "123 Main St, Orem, UT 84058",
    entity_type: "LLC",
    lead_channels: ["missed_calls"],
    website_editor_contact: "ben@example.com",
  }
  it("passes with the full phase-2 set", () => {
    expect(allRequiredPresent(full)).toBe(true)
  })
  it("fails when any new field is missing", () => {
    for (const key of [
      "brand_colors_confirmed", "legal_business_name", "ein",
      "business_address", "entity_type", "lead_channels", "website_editor_contact",
    ]) {
      const partial: Record<string, unknown> = { ...full }
      delete partial[key]
      expect(allRequiredPresent(partial)).toBe(false)
    }
  })
  it("requires lead_channels to be a non-empty array", () => {
    expect(allRequiredPresent({ ...full, lead_channels: [] })).toBe(false)
  })
  it("requires brand_colors_confirmed to be strictly true", () => {
    expect(allRequiredPresent({ ...full, brand_colors_confirmed: "yes" })).toBe(false)
  })
})
