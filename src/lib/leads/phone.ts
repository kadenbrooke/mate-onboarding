// Phone handling for Lead Snapshot.
//
// Two different jobs, deliberately kept separate:
//
//   toE164()          what we hand Telnyx to actually send a text.
//   leadKeyFromPhone  what we compare on to decide "same lead" (last 10 digits).
//
// The dedupe key is NOT the send format. lead_key is the app's existing identity
// notion, mirrored in SQL by normalise_lead_phone() (migration 0015) and by
// phoneDigits() in the Ticker. Do not add a fourth normaliser: import the one
// that already exists.
import { leadKeyFromPhone } from '@/lib/metrics/eventSources';

export { leadKeyFromPhone };

/** E.164 as Telnyx wants it: +, country code, subscriber number, no separators. */
const E164 = /^\+[1-9]\d{9,14}$/;

export type PhoneResult =
  | { ok: true; e164: string; leadKey: string }
  | { ok: false; reason: 'empty' | 'too-short' | 'too-long' | 'not-dialable' };

/**
 * Normalise a human-written phone into E.164, or say why it cannot be.
 *
 * Deliberately conservative, because the failure mode that matters is texting a
 * stranger. A 10 digit string is assumed North American and gets +1. An 11 digit
 * string starting with 1 is the same number written differently. Anything else
 * that already carries a + is trusted as written and validated. Everything else
 * is rejected rather than guessed at: no area code invention, which is the same
 * rule the extraction prompt puts on the model.
 */
export function toE164(raw: string | null | undefined): PhoneResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) return { ok: false, reason: 'empty' };

  let candidate: string;
  if (hadPlus) {
    candidate = `+${digits}`;
  } else if (digits.length === 10) {
    candidate = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    candidate = `+${digits}`;
  } else if (digits.length < 10) {
    return { ok: false, reason: 'too-short' };
  } else if (digits.length > 15) {
    return { ok: false, reason: 'too-long' };
  } else {
    // 11 to 15 digits with no leading + and no leading 1. Could be an
    // international number missing its +, could be a misread with an extra
    // digit. Both are plausible and we cannot tell them apart, so refuse.
    return { ok: false, reason: 'not-dialable' };
  }

  if (!E164.test(candidate)) return { ok: false, reason: 'not-dialable' };

  const leadKey = leadKeyFromPhone(candidate);
  if (!leadKey) return { ok: false, reason: 'too-short' };

  return { ok: true, e164: candidate, leadKey };
}

/** Human-readable reason, for the confirm screen. No jargon: the client reads this. */
export function phoneRejectionMessage(reason: Exclude<PhoneResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'empty':
      return 'No phone number.';
    case 'too-short':
      return 'That number is too short to text.';
    case 'too-long':
      return 'That number is too long to text.';
    case 'not-dialable':
      return 'That number does not look textable. Check the digits.';
  }
}
