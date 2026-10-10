// Cross-deployment handling for the cal.com webhook.
//
// Once a client has moved to its own deployment (MATE_MOVED_SESSIONS), a
// booking that still arrives at the old URL must not be written to the old
// project, and must never vanish. A dedicated deployment likewise holds any
// booking it cannot attribute to a session it serves. On the shared side:
//   * attributed to a moved session -> forwarded server-side to that
//     deployment's webhook, with the exact signed body and only the headers the
//     receiver needs (content-type, x-cal-signature-256);
//   * forward fails, or the booking cannot be attributed -> HELD: the exact
//     signed body is stored in calcom_held_bookings (control project), and the
//     founder is told through the normal notification path (an outbound_texts
//     row, which the router delivers; never a direct text). The message names
//     no lead.
// Reconcile held rows with scripts/replay-held-calcom.mjs (see
// docs/deploy/jc-dedicated-deployment.md, "Held cal.com bookings").

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const FORWARD_TIMEOUT_MS = 8000;

/** The only headers a forwarded booking carries. Nothing else of the caller's
 *  request (cookies, authorization, host, x-forwarded-*) crosses deployments. */
export function forwardHeaders(signature: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-cal-signature-256': signature };
}

export type ForwardResult = { ok: true; status: number } | { ok: false; detail: string };

export async function forwardBooking(
  origin: string,
  rawBody: string,
  signature: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ForwardResult> {
  try {
    const res = await fetchImpl(new URL('/api/webhooks/calcom', origin), {
      method: 'POST',
      headers: forwardHeaders(signature),
      body: rawBody,
      // A redirect here would mean the target is not the deployment we think it
      // is: hold the booking rather than follow it somewhere else.
      redirect: 'manual',
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, detail: `forward answered ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `forward failed: ${err instanceof Error ? err.name : 'error'}` };
  }
}

export type HoldInput = {
  rawBody: string;
  triggerEvent: string | null;
  bookingUid: string | null;
  reason: string;
  targetSessionId: string | null;
};

export type HoldResult =
  /** Stored. `alerted` = the founder alert is in the outbox (this delivery or an earlier one). */
  | { held: true; alerted: boolean; duplicate: boolean; alertKey: string }
  | { held: false; alerted: boolean; detail: string };

const UNIQUE_VIOLATION = '23505';

/**
 * Deterministic identity of a delivery, so cal.com retries of the same booking
 * land on one held row: the booking uid + trigger when there is a uid, else a
 * hash of the exact signed body.
 */
export function holdKey(input: Pick<HoldInput, 'rawBody' | 'triggerEvent' | 'bookingUid'>): string {
  if (input.bookingUid) return `uid:${input.triggerEvent ?? ''}:${input.bookingUid}`;
  return `body:${createHash('sha256').update(input.rawBody, 'utf8').digest('hex')}`;
}

/**
 * The one alert key for a delivery, derived from holdKey BEFORE anything is
 * stored: `mate:calcom-held:<sha256(dedupe_key) hex>`. It is the
 * outbound_texts source (one per booking delivery) and is stored on the held
 * row, so the saved and unsaved paths enqueue the identical alert.
 */
export const ALERT_SOURCE_PREFIX = 'mate:calcom-held:';

export function alertKey(dedupeKey: string): string {
  return `${ALERT_SOURCE_PREFIX}${createHash('sha256').update(dedupeKey, 'utf8').digest('hex')}`;
}

/** Short ref for humans: the first 12 hex of the key's digest. */
export function alertRef(key: string): string {
  return key.slice(ALERT_SOURCE_PREFIX.length, ALERT_SOURCE_PREFIX.length + 12);
}

/** Same text whether or not the held row could be stored. Names no lead. */
export function alertMessage(key: string): string {
  return (
    `Mate could not route a cal.com booking to a client's own dashboard (ref ${alertRef(key)}). ` +
    `Nothing was written to either client's data. It is in the held-bookings list; if that ref ` +
    `is not there yet it could not be stored and cal.com is retrying. Reconcile with the ` +
    `held-bookings replay (Mate deploy doc, "Held cal.com bookings").`
  );
}

/**
 * Put the alert for `key` in the outbox exactly once.
 *
 * The database decides, not the caller: migration 0025 adds a unique index on
 * outbound_texts(source) for sources starting with ALERT_SOURCE_PREFIX. The
 * first insert for a key wins; every other insert for it (a retry, a
 * concurrent delivery, a slow delivery that resumes late, the unsaved path
 * followed by the saved one) fails with a unique violation, which means "the
 * alert is already queued" and counts as alerted. There is no
 * check-then-insert window to race.
 *
 * Any other error means the alert is not known to be queued: the caller
 * answers non-2xx so cal.com retries.
 */
async function ensureAlert(control: SupabaseClient, key: string): Promise<boolean> {
  const { error } = await control
    .from('outbound_texts')
    .insert({ message: alertMessage(key), source: key });
  return !error || error.code === UNIQUE_VIOLATION;
}

/**
 * Store the booking, then make sure its founder alert is in the outbox once.
 * The caller answers 2xx only when `held && alerted`, so cal.com retries until
 * both are true; every retry is idempotent (holdKey for the row, the unique
 * alert source for the alert).
 */
export async function holdBooking(control: SupabaseClient, input: HoldInput): Promise<HoldResult> {
  const dedupeKey = holdKey(input);
  const key = alertKey(dedupeKey);

  const { error: holdError } = await control
    .from('calcom_held_bookings')
    .insert({
      dedupe_key: dedupeKey,
      alert_key: key,
      raw_body: input.rawBody,
      trigger_event: input.triggerEvent,
      booking_uid: input.bookingUid,
      reason: input.reason,
      target_session_id: input.targetSessionId,
    });
  const duplicate = holdError?.code === UNIQUE_VIOLATION;
  const stored = !holdError || duplicate;

  const alerted = await ensureAlert(control, key);
  if (!stored) return { held: false, alerted, detail: holdError?.message ?? 'not stored' };
  return { held: true, alerted, duplicate, alertKey: key };
}
