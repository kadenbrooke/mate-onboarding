import { describe, it, expect } from "vitest"
import { maskEin, maskCollectedForClient, stripServerOnly } from "./mask"

describe("maskEin", () => {
  it("masks to last 4", () => {
    expect(maskEin("12-3456789")).toBe("*****6789")
    expect(maskEin("123456789")).toBe("*****6789")
  })
  it("returns null for non-strings/empties", () => {
    expect(maskEin("")).toBeNull()
    expect(maskEin(undefined)).toBeNull()
  })
})

describe("maskCollectedForClient", () => {
  it("masks ein, leaves everything else untouched", () => {
    const out = maskCollectedForClient({ ein: "12-3456789", services: ["x"] })
    expect(out.ein).toBe("*****6789")
    expect(out.services).toEqual(["x"])
  })
  it("passes through when no ein", () => {
    expect(maskCollectedForClient({ a: 1 })).toEqual({ a: 1 })
  })
  it("never throws on garbage", () => {
    expect(maskCollectedForClient(null as unknown as Record<string, unknown>)).toEqual({})
  })
})

describe("stripServerOnly", () => {
  it("removes ein entirely (for the Business Mate profile tool)", () => {
    const out = stripServerOnly({ ein: "123456789", brand_voice: "warm" })
    expect(out.ein).toBeUndefined()
    expect(out.brand_voice).toBe("warm")
  })
})
