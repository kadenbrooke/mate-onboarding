import { describe, it, expect } from "vitest"
import {
  MAX_DEMOS_PER_PHONE_PER_DAY,
  MAX_DEMOS_PER_DAY,
  checkGuard,
} from "./guard"

describe("checkGuard", () => {
  it("allows a first-time phone under both caps", () => {
    const r = checkGuard({ phoneCountToday: 0, totalCountToday: 0 })
    expect(r.allowed).toBe(true)
    expect(r.reason).toBeUndefined()
  })

  it("blocks when the per-phone daily cap is reached", () => {
    const r = checkGuard({
      phoneCountToday: MAX_DEMOS_PER_PHONE_PER_DAY,
      totalCountToday: 0,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("phone_limit")
  })

  it("blocks when the global daily circuit breaker trips", () => {
    const r = checkGuard({
      phoneCountToday: 0,
      totalCountToday: MAX_DEMOS_PER_DAY,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("daily_limit")
  })

  it("global breaker takes precedence over per-phone when both would block", () => {
    const r = checkGuard({
      phoneCountToday: MAX_DEMOS_PER_PHONE_PER_DAY,
      totalCountToday: MAX_DEMOS_PER_DAY,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("daily_limit")
  })

  it("allows right up to (but not at) each cap", () => {
    expect(
      checkGuard({
        phoneCountToday: MAX_DEMOS_PER_PHONE_PER_DAY - 1,
        totalCountToday: MAX_DEMOS_PER_DAY - 1,
      }).allowed
    ).toBe(true)
  })

  it("caps are sane positive integers", () => {
    expect(MAX_DEMOS_PER_PHONE_PER_DAY).toBeGreaterThan(0)
    expect(MAX_DEMOS_PER_DAY).toBeGreaterThan(MAX_DEMOS_PER_PHONE_PER_DAY)
  })
})
