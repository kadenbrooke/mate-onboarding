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

/** How long a claimed-but-unconfirmed alert blocks other deliveries before one may re-claim it. */
export const ALERT_CLAIM_TTL_MS = 60_000;

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
 * stored. It is the outbound_texts source (one source per booking delivery),
 * the claim ledger's primary key, and the ref in the text, so the saved and
 * unsaved paths enqueue the identical alert.
 */
export function alertKey(dedupeKey: string): string {
  return `mate:calcom-held:${createHash('sha256').update(dedupeKey, 'utf8').digest('hex').slice(0, 16)}`;
}

/** Same text whether or not the held row could be stored. Names no lead. */
export function alertMessage(key: string): string {
  const ref = key.slice(key.lastIndexOf(':') + 1);
  return (
    `Mate could not route a cal.com booking to a client's own dashboard (ref ${ref}). ` +
    `Nothing was written to either client's data. It is in the held-bookings list; if that ref ` +
    `is not there yet it could not be stored and cal.com is retrying. Reconcile with the ` +
    `held-bookings replay (Mate deploy doc, "Held cal.com bookings").`
  );
}

type AlertState = 'sent' | 'already' | 'pending' | 'failed';

/**
 * Put the alert for `key` in the outbox exactly once.
 *
 *   1. Claim it in calcom_held_alerts (primary key = alert key). Only the
 *      delivery that inserts the claim, or re-claims one left unconfirmed past
 *      ALERT_CLAIM_TTL_MS by a conditional update, may enqueue. Concurrent
 *      deliveries see the claim and answer "pending" (caller: non-2xx, retry).
 *   2. Before enqueueing, look for an outbox row with this source: a delivery
 *      that enqueued and then failed to confirm is not enqueued again.
 *   3. Enqueue (source = key), then confirm (enqueued_at). A failed enqueue
 *      releases the claim; a failed confirm is reported as failure so cal.com
 *      retries, and step 2 makes that retry confirm instead of re-sending.
 *
 * If the claim ledger itself is unavailable (e.g. migration not applied) the
 * alert is still sent, guarded by step 2 only; a concurrent duplicate there
 * carries the identical source and text, which the amos router folds by
 * fingerprint. A booking is never left without an attempted alert.
 */
async function ensureAlert(control: SupabaseClient, key: string): Promise<AlertState> {
  const now = Date.now();
  const claim = await control
    .from('calcom_held_alerts')
    .insert({ alert_key: key, claimed_at: new Date(now).toISOString() });

  let ledger = true;
  if (claim.error?.code === UNIQUE_VIOLATION) {
    const { data: prior, error } = await control
      .from('calcom_held_alerts')
      .select('enqueued_at, claimed_at')
      .eq('alert_key', key)
      .maybeSingle();
    if (error || !prior) return 'pending';
    if (prior.enqueued_at) return 'already';
    const cutoff = new Date(now - ALERT_CLAIM_TTL_MS).toISOString();
    if (Date.parse(String(prior.claimed_at)) > now - ALERT_CLAIM_TTL_MS) return 'pending';
    const { data: reclaimed, error: reclaimError } = await control
      .from('calcom_held_alerts')
      .update({ claimed_at: new Date(now).toISOString() })
      .eq('alert_key', key)
      .is('enqueued_at', null)
      .lt('claimed_at', cutoff)
      .select('alert_key');
    if (reclaimError || !reclaimed || reclaimed.length === 0) return 'pending';
  } else if (claim.error) {
    ledger = false;
  }

  const { data: existing, error: lookupError } = await control
    .from('outbound_texts')
    .select('id')
    .eq('source', key)
    .limit(1)
    .maybeSingle();
  if (lookupError) return 'failed';

  if (!existing) {
    const { error: enqueueError } = await control
      .from('outbound_texts')
      .insert({ message: alertMessage(key), source: key });
    if (enqueueError) {
      if (ledger) {
        await control.from('calcom_held_alerts').delete().eq('alert_key', key).is('enqueued_at', null);
      }
      return 'failed';
    }
  }

  if (ledger) {
    const { error: confirmError } = await control
      .from('calcom_held_alerts')
      .update({ enqueued_at: new Date().toISOString() })
      .eq('alert_key', key);
    if (confirmError) return 'failed';
  }
  return existing ? 'already' : 'sent';
}

/**
 * Store the booking, then make sure its founder alert is in the outbox once.
 * The caller answers 2xx only when `held && alerted`, so cal.com retries until
 * both are true; every retry is idempotent (holdKey, alertKey).
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

  const state = await ensureAlert(control, key);
  const alerted = state === 'sent' || state === 'already';
  if (!stored) return { held: false, alerted, detail: holdError?.message ?? 'not stored' };
  return { held: true, alerted, duplicate, alertKey: key };
}
