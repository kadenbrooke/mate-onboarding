// The fields Mate must collect before the client can finish onboarding. Shared
// by the chat-completion gate (page), the review screen, and the vitality lib
// so they all agree on what "done" means. Pure + testable; no React, no I/O.
//
// Phase 2 expands the set to full BUILD-READINESS: everything needed to build
// the First Responder AND file the 10DLC registration with zero follow-up
// (the north star in the phase-2 spec). leads_per_week / avg_job_value are
// wanted-not-required and deliberately absent here.

export const REQUIRED_KEYS = [
  "services",
  "brand_voice",
  "current_phone",
  "lead_delivery_phone",
  "brand_colors_confirmed",
  "legal_business_name",
  "ein",
  "business_address",
  "entity_type",
  "lead_channels",
  "website_editor_contact",
] as const

export type RequiredKey = (typeof REQUIRED_KEYS)[number]

export interface RequiredCollected {
  services?: unknown
  brand_voice?: unknown
  current_phone?: unknown
  lead_delivery_phone?: unknown
  brand_colors_confirmed?: unknown
  legal_business_name?: unknown
  ein?: unknown
  business_address?: unknown
  entity_type?: unknown
  lead_channels?: unknown
  website_editor_contact?: unknown
}

const nonEmptyString = (v: unknown): boolean =>
  typeof v === "string" && v.trim() !== ""
const nonEmptyArray = (v: unknown): boolean => Array.isArray(v) && v.length > 0

/** A single required field is satisfied when its collected value is present. */
export function isFieldDone(key: RequiredKey, c: RequiredCollected): boolean {
  switch (key) {
    case "services":
      return nonEmptyArray(c.services)
    case "lead_channels":
      return nonEmptyArray(c.lead_channels)
    case "brand_colors_confirmed":
      return c.brand_colors_confirmed === true
    case "brand_voice":
      return nonEmptyString(c.brand_voice)
    case "current_phone":
      return nonEmptyString(c.current_phone)
    case "lead_delivery_phone":
      return nonEmptyString(c.lead_delivery_phone)
    case "legal_business_name":
      return nonEmptyString(c.legal_business_name)
    case "ein":
      return nonEmptyString(c.ein)
    case "business_address":
      return nonEmptyString(c.business_address)
    case "entity_type":
      return nonEmptyString(c.entity_type)
    case "website_editor_contact":
      return nonEmptyString(c.website_editor_contact)
  }
}

/** True once every required field is present in `collected`. */
export function allRequiredPresent(
  c: RequiredCollected | null | undefined
): boolean {
  if (!c || typeof c !== "object") return false
  return REQUIRED_KEYS.every((k) => isFieldDone(k, c))
}

/** Human labels for missing-field highlighting (review screen + gate copy). */
export const REQUIRED_LABELS: Record<RequiredKey, string> = {
  services: "Services",
  brand_voice: "Brand voice",
  current_phone: "Main business line",
  lead_delivery_phone: "Warm-lead cell",
  brand_colors_confirmed: "Brand colors",
  legal_business_name: "Legal business name",
  ein: "EIN",
  business_address: "Business address",
  entity_type: "Entity type",
  lead_channels: "Lead channels",
  website_editor_contact: "Website contact",
}

/** The required keys still missing, in display order. */
export function missingRequired(c: RequiredCollected | null | undefined): RequiredKey[] {
  if (!c || typeof c !== "object") return [...REQUIRED_KEYS]
  return REQUIRED_KEYS.filter((k) => !isFieldDone(k, c))
}
