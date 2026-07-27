import { describe, it, expect } from "vitest"
import { toE164, isValidDemoPhone, genPhoneCode, isPhoneCode } from "./phone"

describe("toE164", () => {
  it("adds +1 to a bare 10-digit US number", () => {
    expect(toE164("8014583118")).toBe("+18014583118")
  })
  it("adds + to an 11-digit number starting with 1", () => {
    expect(toE164("18014583118")).toBe("+18014583118")
  })
  it("strips formatting then normalizes", () => {
    expect(toE164("(801) 458-3118")).toBe("+18014583118")
    expect(toE164("801.458.3118")).toBe("+18014583118")
    expect(toE164("+1 801 458 3118")).toBe("+18014583118")
  })
  it("preserves an already-E.164 non-US number", () => {
    expect(toE164("+447911123456")).toBe("+447911123456")
  })
  it("returns null for junk / too-short input", () => {
    expect(toE164("")).toBeNull()
    expect(toE164("abc")).toBeNull()
    expect(toE164("12345")).toBeNull()
  })
})

describe("isValidDemoPhone", () => {
  it("accepts normalizable numbers", () => {
    expect(isValidDemoPhone("8014583118")).toBe(true)
    expect(isValidDemoPhone("+18014583118")).toBe(true)
  })
  it("rejects junk", () => {
    expect(isValidDemoPhone("")).toBe(false)
    expect(isValidDemoPhone("nope")).toBe(false)
  })
})

describe("genPhoneCode", () => {
  it("returns a 6-digit numeric string (H4: widened code space)", () => {
    for (let i = 0; i < 200; i++) {
      const code = genPhoneCode()
      expect(code).toMatch(/^\d{6}$/)
    }
  })
})

describe("isPhoneCode", () => {
  it("matches a bare 6-digit body", () => {
    expect(isPhoneCode("123456")).toBe(true)
    expect(isPhoneCode(" 123456 ")).toBe(true)
  })
  it("does not match 4-digit, longer, or non-numeric bodies", () => {
    expect(isPhoneCode("1234")).toBe(false)
    expect(isPhoneCode("1234567")).toBe(false)
    expect(isPhoneCode("hello")).toBe(false)
    expect(isPhoneCode("12a456")).toBe(false)
  })
})
