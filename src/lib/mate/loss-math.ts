/**
 * Deterministic missed-lead loss math for the birth flow's value moment.
 * NEVER computed by the model (LLM arithmetic is not trustworthy); the card
 * calls this and renders the result. Pure + unit-tested.
 *
 * Model: assume 1 in 10 leads currently hits voicemail/no-answer and walks.
 * annual loss = leadsPerWeek * 0.10 * avgJobValue * 52.
 */
export const MISSED_FRACTION = 0.1

export function annualLoss(leadsPerWeek: number, avgJobValue: number): number | null {
  if (!Number.isFinite(leadsPerWeek) || !Number.isFinite(avgJobValue)) return null
  if (leadsPerWeek <= 0 || avgJobValue <= 0) return null
  return Math.round(leadsPerWeek * MISSED_FRACTION * avgJobValue * 52)
}

/** Client-facing loss line. Loss framing, their numbers. Null when no math. */
export function lossMessage(leadsPerWeek: number, avgJobValue: number): string | null {
  const loss = annualLoss(leadsPerWeek, avgJobValue)
  if (loss === null) return null
  const dollars = `$${loss.toLocaleString("en-US")}`
  return `If even 1 in 10 of your ${leadsPerWeek} weekly leads hits voicemail and moves on, that is ${dollars} a year walking to a competitor who answered first. Your assistant answers in under 60 seconds, every time.`
}
