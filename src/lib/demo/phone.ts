// Phone helpers for the Instant First Responder Demo.
//
// Caller ID is the join key that maps an inbound call/text back to a demo_sessions
// row, so both the form-entered number and the number Telnyx reports on the
// webhook must normalize to the SAME E.164 string. These helpers own that
// normalization plus the 4-digit no-caller-ID fallback code.

/** Strip common formatting characters. */
function strip(raw: string): string {
  return raw.trim().replace(/[\s()\-.]/g, "")
}

/**
 * Normalize a phone to E.164 (+<digits>) so a form entry and a Telnyx webhook
 * value collapse to the same join key. US-friendly: a bare 10-digit number gets
 * +1, an 11-digit number starting with 1 gets a leading +. Anything else that is
 * already +<7..15 digits> passes through. Returns null for junk / out-of-range.
 */
export function toE164(raw: string): string | null {
  if (typeof raw !== "string") return null
  const cleaned = strip(raw)
  if (cleaned === "") return null

  // Already E.164-ish (+ and 7..15 digits).
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned

  const digits = cleaned.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  // Fall back to a lenient E.164 for other international-length bare numbers.
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`
  return null
}

/** True when the input normalizes to a usable E.164 number. */
export function isValidDemoPhone(raw: string): boolean {
  return toE164(raw) !== null
}

/**
 * A random 6-digit fallback code (leading zeros allowed). The prospect texts this
 * to the demo number so we can bind their phone when caller ID is withheld.
 * Widened from 4 to 6 digits (HIGH FIX H4) so the code space is 1,000,000 rather
 * than 10,000; combined with the per-sender attempt throttle this makes brute force
 * impractical. Collisions are avoided at insert time by the unique partial index on
 * (phone_code) where status='building'.
 */
export function genPhoneCode(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")
}

/** True when an inbound SMS body is exactly a 6-digit code (the fallback path). */
export function isPhoneCode(body: string): boolean {
  return /^\d{6}$/.test(body.trim())
}
