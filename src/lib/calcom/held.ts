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
  /** Stored. `alerted` = the founder signal is in the outbox (now or on an earlier delivery). */
  | { held: true; id: string; alerted: boolean; duplicate: boolean }
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

function alertMessage(ref: string, reason: string): string {
  return (
    `Mate held a cal.com booking it could not route to a moved client's dashboard ` +
    `(ref ${ref}, ${reason}). Nothing was written to either project. ` +
    `Reconcile it with the held-bookings replay (Mate deploy doc, "Held cal.com bookings").`
  );
}

type HeldRow = { id: string; reason: string; alerted_at: string | null };

/**
 * Store the booking, then make sure the founder signal is in the outbox.
 *
 * Idempotent per holdKey. The alert's delivery is tracked on the row
 * (alerted_at): a retry of a booking whose alert did not land tries the alert
 * again. The caller answers non-2xx unless `held && alerted`, so cal.com keeps
 * retrying until both are true. The alert text is deterministic per row, so a
 * repeat that slips through (alert landed, alerted_at write failed) is folded
 * by the router's dedupe.
 */
export async function holdBooking(control: SupabaseClient, input: HoldInput): Promise<HoldResult> {
  const dedupeKey = holdKey(input);
  let duplicate = false;
  let row: HeldRow | null = null;

  const inserted = await control
    .from('calcom_held_bookings')
    .insert({
      dedupe_key: dedupeKey,
      raw_body: input.rawBody,
      trigger_event: input.triggerEvent,
      booking_uid: input.bookingUid,
      reason: input.reason,
      target_session_id: input.targetSessionId,
    })
    .select('id, reason, alerted_at')
    .single();

  if (inserted.error?.code === UNIQUE_VIOLATION) {
    duplicate = true;
    const existing = await control
      .from('calcom_held_bookings')
      .select('id, reason, alerted_at')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    row = (existing.data as HeldRow | null) ?? null;
    if (!row) return { held: false, alerted: false, detail: existing.error?.message ?? 'held row vanished' };
  } else if (inserted.error || !inserted.data) {
    // Not stored. Still tell the founder, then let the caller answer an error.
    const { error: alertError } = await control.from('outbound_texts').insert({
      message: alertMessage('unsaved', `${input.reason}; could not store it: ${inserted.error?.code ?? 'error'}`),
      source: 'mate:calcom-held:unsaved',
    });
    return { held: false, alerted: !alertError, detail: inserted.error?.message ?? 'no row' };
  } else {
    row = inserted.data as HeldRow;
  }

  if (row.alerted_at) return { held: true, id: row.id, alerted: true, duplicate };

  const ref = row.id.slice(0, 8);
  const { error: alertError } = await control
    .from('outbound_texts')
    .insert({ message: alertMessage(ref, row.reason), source: `mate:calcom-held:${ref}` });
  if (alertError) return { held: true, id: row.id, alerted: false, duplicate };

  // The alert is in the outbox. If recording that fails, a retry may queue it
  // again; the identical text is deduped by the router, so that is harmless.
  await control
    .from('calcom_held_bookings')
    .update({ alerted_at: new Date().toISOString() })
    .eq('id', row.id);
  return { held: true, id: row.id, alerted: true, duplicate };
}
