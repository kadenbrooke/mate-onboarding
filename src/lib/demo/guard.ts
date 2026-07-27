// Abuse guard for the Instant First Responder Demo.
//
// Two layers, both cheap and both enforced BEFORE any scrape or model call runs
// (each demo costs us a Telnyx segment + two model calls):
//   1. per-phone/day rate limit  — one prospect can not spam the funnel.
//   2. global daily circuit breaker — a hard kill switch on total demos/day so a
//      bad actor (or a viral moment) can not run up cost. The global breaker takes
//      precedence, since it is the cost-safety backstop.
//
// checkGuard is PURE: the caller supplies the two counts (queried from
// demo_sessions for today) and gets an allow/deny decision. This keeps the policy
// unit-testable and the DB query in the route.

// Env-overridable so the founder can tighten/loosen without a redeploy (read at
// call time in the route, defaults here as the source of truth for tests).
export const MAX_DEMOS_PER_PHONE_PER_DAY = 3
export const MAX_DEMOS_PER_DAY = 200

export type GuardReason = "phone_limit" | "daily_limit"

export interface GuardResult {
  allowed: boolean
  reason?: GuardReason
}

export interface GuardCounts {
  phoneCountToday: number
  totalCountToday: number
}

export interface GuardCaps {
  perPhone?: number
  daily?: number
}

/**
 * Decide whether a new demo is allowed. Global daily breaker is checked first so
 * the cost backstop always wins. Caps default to the module constants but can be
 * overridden (env-driven) by the caller.
 */
export function checkGuard(counts: GuardCounts, caps: GuardCaps = {}): GuardResult {
  const perPhone = caps.perPhone ?? MAX_DEMOS_PER_PHONE_PER_DAY
  const daily = caps.daily ?? MAX_DEMOS_PER_DAY

  if (counts.totalCountToday >= daily) {
    return { allowed: false, reason: "daily_limit" }
  }
  if (counts.phoneCountToday >= perPhone) {
    return { allowed: false, reason: "phone_limit" }
  }
  return { allowed: true }
}
