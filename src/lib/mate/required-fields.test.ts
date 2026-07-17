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
}

describe("required-fields", () => {
  it("exposes exactly the four gate fields", () => {
    expect([...REQUIRED_KEYS]).toEqual([
      "services",
      "brand_voice",
      "current_phone",
      "lead_delivery_phone",
    ])
  })

  it("allRequiredPresent is true only when all four are present", () => {
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
