/**
 * Basic E.164-ish phone validation shared by the phone cards.
 *
 * Not a full E.164 validator (no per-country length rules) — just enough to
 * catch obviously bad input: strips common formatting, then requires an
 * optional leading + and 7 to 15 digits. Intentionally lenient so a US owner
 * typing "(385) 000-0000" or "+1 385 000 0000" both pass.
 */
export function normalizePhone(raw: string): string {
  return raw.trim().replace(/[\s()\-.]/g, "")
}

export function isValidPhone(raw: string): boolean {
  const cleaned = normalizePhone(raw)
  return /^\+?\d{7,15}$/.test(cleaned)
}
