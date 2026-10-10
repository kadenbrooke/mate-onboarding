// Moved-tenant handling for the cal.com webhook on the SHARED deployment.
//
// Once a client has moved to its own deployment (MATE_MOVED_SESSIONS), a
// booking that still arrives at the old URL must not be written to the old
// project, and must never vanish:
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
  | { held: true; id: string; alerted: boolean; duplicate: boolean }
  | { held: false; alerted: boolean; detail: string };

const UNIQUE_VIOLATION = '23505';

function alertMessage(ref: string, reason: string): string {
  return (
    `Mate held a cal.com booking it could not route to a moved client's dashboard ` +
    `(ref ${ref}, ${reason}). Nothing was written to either project. ` +
    `Reconcile it with the held-bookings replay (Mate deploy doc, "Held cal.com bookings").`
  );
}

/** Store the booking and raise the founder signal. Idempotent per (booking uid, trigger). */
export async function holdBooking(control: SupabaseClient, input: HoldInput): Promise<HoldResult> {
  const { data, error } = await control
    .from('calcom_held_bookings')
    .insert({
      raw_body: input.rawBody,
      trigger_event: input.triggerEvent,
      booking_uid: input.bookingUid,
      reason: input.reason,
      target_session_id: input.targetSessionId,
    })
    .select('id')
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    // cal.com retried a booking we already hold and already alerted on.
    return { held: true, id: 'existing', alerted: false, duplicate: true };
  }

  const ref = data?.id ? String(data.id).slice(0, 8) : 'unsaved';
  const reason = error ? `${input.reason}; could not store it: ${error.code ?? 'error'}` : input.reason;
  const { error: alertError } = await control
    .from('outbound_texts')
    .insert({ message: alertMessage(ref, reason), source: `mate:calcom-held:${ref}` });

  if (error || !data) return { held: false, alerted: !alertError, detail: error?.message ?? 'no row' };
  return { held: true, id: String(data.id), alerted: !alertError, duplicate: false };
}
