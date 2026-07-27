// E.164 normalization for the demo edge functions (Deno mirror of
// src/lib/demo/phone.ts::toE164). Caller ID reported by Telnyx and the number the
// prospect typed on the form must collapse to the SAME join key, so this must
// match the app's normalization exactly.

export function toE164(raw: string): string | null {
  if (typeof raw !== "string") return null
  const cleaned = raw.trim().replace(/[\s()\-.]/g, "")
  if (cleaned === "") return null
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned
  const digits = cleaned.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`
  return null
}

/** True when an inbound SMS body is exactly a 6-digit fallback code (H4). */
export function isPhoneCode(body: string): boolean {
  return /^\d{6}$/.test(body.trim())
}
