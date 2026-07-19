import { describe, it, expect } from "vitest"
import { contrastRatio, meetsAA, nearestAA } from "./contrast"

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0)
  })
  it("is 1 for identical colors", () => {
    expect(contrastRatio("#e14d1a", "#e14d1a")).toBeCloseTo(1, 5)
  })
  it("is symmetric", () => {
    expect(contrastRatio("#2a2f8f", "#101418")).toBeCloseTo(
      contrastRatio("#101418", "#2a2f8f"),
      5
    )
  })
  it("returns 1 for unparseable input (never throws)", () => {
    expect(contrastRatio("nope", "#ffffff")).toBe(1)
  })
})

describe("meetsAA", () => {
  it("passes brand orange on dark", () => {
    expect(meetsAA("#e14d1a", "#141414")).toBe(true)
  })
  it("fails the 3TR case: dark blue on near-black", () => {
    expect(meetsAA("#2a2f8f", "#101418")).toBe(false)
  })
})

describe("nearestAA", () => {
  it("returns the input unchanged when it already passes", () => {
    expect(nearestAA("#e14d1a", "#141414")).toBe("#e14d1a")
  })
  it("lightens a dark primary on a dark bg until AA passes", () => {
    const fixed = nearestAA("#2a2f8f", "#101418")
    expect(meetsAA(fixed, "#101418")).toBe(true)
    expect(fixed).not.toBe("#2a2f8f")
  })
  it("darkens a light primary on a light bg until AA passes", () => {
    const fixed = nearestAA("#ffd9a0", "#ffffff")
    expect(meetsAA(fixed, "#ffffff")).toBe(true)
  })
  it("preserves hue family (red channel still dominant for an orange)", () => {
    const fixed = nearestAA("#7a2a10", "#141414")
    const r = parseInt(fixed.slice(1, 3), 16)
    const b = parseInt(fixed.slice(5, 7), 16)
    expect(r).toBeGreaterThan(b)
  })
  it("returns input unchanged for unparseable values", () => {
    expect(nearestAA("junk", "#141414")).toBe("junk")
  })
})
