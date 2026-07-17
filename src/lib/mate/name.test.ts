import { describe, it, expect } from "vitest"
import { defaultMateName } from "./name"

describe("defaultMateName", () => {
  it("appends Mate to the business name", () => {
    expect(defaultMateName("J&C Asphalt Paving")).toBe("J&C Asphalt Paving Mate")
  })
  it("falls back when no name", () => {
    expect(defaultMateName("")).toBe("Mate")
  })
  it("trims surrounding whitespace before appending", () => {
    expect(defaultMateName("  Acme Plumbing  ")).toBe("Acme Plumbing Mate")
  })
  it("falls back to Mate when the name is only whitespace", () => {
    expect(defaultMateName("   ")).toBe("Mate")
  })
})
