import { describe, it, expect } from "vitest"
import { annualLoss, lossMessage } from "./loss-math"

describe("annualLoss", () => {
  it("computes leads x 10% x value x 52", () => {
    expect(annualLoss(12, 4800)).toBe(299520)
  })
  it("returns null for zero, negative, or missing inputs", () => {
    expect(annualLoss(0, 4800)).toBeNull()
    expect(annualLoss(12, 0)).toBeNull()
    expect(annualLoss(-1, 100)).toBeNull()
    expect(annualLoss(NaN, 100)).toBeNull()
  })
})

describe("lossMessage", () => {
  it("formats a whole-dollar loss with commas, no em dashes, no emoji", () => {
    const msg = lossMessage(12, 4800)
    expect(msg).toContain("$299,520")
    expect(msg).not.toContain("—")
  })
  it("returns null when the math is null", () => {
    expect(lossMessage(0, 0)).toBeNull()
  })
})
