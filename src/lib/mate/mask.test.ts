import { describe, it, expect } from "vitest"
import { maskEin, maskCollectedForClient, stripServerOnly, isMaskedValue, scrubEinPatterns } from "./mask"

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

describe("isMaskedValue", () => {
  it("detects the masked display form", () => {
    expect(isMaskedValue("*****6789")).toBe(true)
  })
  it("rejects real values and non-strings", () => {
    expect(isMaskedValue("123456789")).toBe(false)
    expect(isMaskedValue(undefined)).toBe(false)
  })
})

describe("scrubEinPatterns", () => {
  it("scrubs XX-XXXXXXX and bare 9-digit runs", () => {
    expect(scrubEinPatterns("my ein is 12-3456789 ok")).toBe("my ein is ***** ok")
    expect(scrubEinPatterns("it is 123456789.")).toBe("it is *****.")
  })
  it("leaves 10-digit phones and normal text alone", () => {
    expect(scrubEinPatterns("call 8015551234 now")).toBe("call 8015551234 now")
    expect(scrubEinPatterns("hello")).toBe("hello")
  })
})

it("never returns an unmaskable string ein raw", () => {
  expect(maskCollectedForClient({ ein: "12-3" }).ein).toBe("*****")
})
