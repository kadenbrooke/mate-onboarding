/**
 * Birth-progress model for the onboarding vitality header. Pure: collected in,
 * { chips, percent } out. Shared by the header strip and the review screen so
 * both agree on how alive the agent is. No React, no I/O.
 *
 * percent is REQUIRED-FIELD completion (the same finish line as
 * required-fields.ts), so the bar can never read 100 while the review gate
 * still blocks. Chips are the celebratory milestone layer on top.
 */
import {
  REQUIRED_KEYS,
  isFieldDone,
  type RequiredCollected,
} from "./required-fields"

export interface VitalityChip {
  key: "colors" | "trade" | "voice" | "calls" | "license"
  label: string
  unlocked: boolean
}

type Collected = Record<string, unknown>

const has = (c: Collected, k: string): boolean => {
  const v = c[k]
  if (typeof v === "string") return v.trim() !== ""
  if (Array.isArray(v)) return v.length > 0
  return v === true
}

/** Chip roster in display order. Definitions double as the unlock rules. */
export const VITALITY_CHIPS: {
  key: VitalityChip["key"]
  label: string
  unlockedBy: (c: Collected) => boolean
}[] = [
  { key: "colors", label: "Has your colors", unlockedBy: (c) => c.brand_colors_confirmed === true },
  { key: "trade", label: "Knows your trade", unlockedBy: (c) => has(c, "services") },
  { key: "voice", label: "Speaks your voice", unlockedBy: (c) => has(c, "brand_voice") },
  { key: "calls", label: "Can hear calls", unlockedBy: (c) => has(c, "current_phone") && has(c, "lead_delivery_phone") },
  {
    key: "license",
    label: "Licensed to text",
    unlockedBy: (c) =>
      has(c, "legal_business_name") && has(c, "ein") && has(c, "business_address") && has(c, "entity_type"),
  },
]

export function vitality(collected: unknown): { chips: VitalityChip[]; percent: number } {
  const c: Collected =
    collected && typeof collected === "object" && !Array.isArray(collected)
      ? (collected as Collected)
      : {}

  const chips = VITALITY_CHIPS.map(({ key, label, unlockedBy }) => ({
    key,
    label,
    unlocked: unlockedBy(c),
  }))

  const done = REQUIRED_KEYS.filter((k) => isFieldDone(k, c as RequiredCollected)).length
  const percent = Math.round((done / REQUIRED_KEYS.length) * 100)

  return { chips, percent }
}
