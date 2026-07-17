// The fields Mate must collect in the chat before the client can move to the
// review screen and finish onboarding. Shared by the chat-completion gate (page)
// and the review screen so both agree on what "done" means. Pure + testable; no
// React, no I/O — keep it that way so the .ts test suite can import it.

export const REQUIRED_KEYS = [
  "services",
  "brand_voice",
  "current_phone",
  "lead_delivery_phone",
] as const

export type RequiredKey = (typeof REQUIRED_KEYS)[number]

// The subset of a session's collected blob these checks read. A loose shape on
// purpose: collected is a JSONB grab-bag, we only assert the four we gate on.
export interface RequiredCollected {
  services?: unknown
  brand_voice?: unknown
  current_phone?: unknown
  lead_delivery_phone?: unknown
}

/** A single required field is satisfied when its collected value is present. */
export function isFieldDone(key: RequiredKey, c: RequiredCollected): boolean {
  switch (key) {
    case "services":
      return Array.isArray(c.services) && c.services.length > 0
    case "brand_voice":
      return typeof c.brand_voice === "string" && c.brand_voice.trim() !== ""
    case "current_phone":
      return typeof c.current_phone === "string" && c.current_phone.trim() !== ""
    case "lead_delivery_phone":
      return (
        typeof c.lead_delivery_phone === "string" &&
        c.lead_delivery_phone.trim() !== ""
      )
  }
}

/** True once every required field is present in `collected`. */
export function allRequiredPresent(
  c: RequiredCollected | null | undefined
): boolean {
  if (!c || typeof c !== "object") return false
  return REQUIRED_KEYS.every((k) => isFieldDone(k, c))
}
