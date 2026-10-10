import { NextResponse } from 'next/server';
import { createControlServiceClient, createServiceClient } from '@/lib/supabase/service';
import { readTenancy, routeSession } from '@/lib/supabase/tenancy';
import { verifyCalcomSignature } from '@/lib/calcom/verify';
import { extractContact, buildBookingPatch, type CalcomWebhook } from '@/lib/calcom/booking';
import { attributeBooking, readCalcomOwners, type CalcomOwners } from '@/lib/calcom/attribution';
import { forwardBooking, holdBooking } from '@/lib/calcom/held';

export const runtime = 'nodejs';

// cal.com BOOKING_CREATED handler for the J&C Cultivator (cultivator-spec.md Piece 4).
// Matches the booking to a jc_sms_conversations row by phone/email, records the
// booking, exits any active drip, and stores the cal.com uid. Stub-safe: with no
// real cal.com event connected nothing fires, and an unmatched booking is a no-op.
//
// Tenancy (lib/supabase/tenancy). The payload carries no session id, so a
// booking is attributed by its signed event type / organizer
// (CALCOM_BOOKING_OWNERS, lib/calcom/attribution):
//   shared, nothing moved   -> exactly as before.
//   shared, a client moved  -> its bookings are forwarded to its deployment;
//                              a failed forward or an unattributable booking is
//                              held and the founder is told (lib/calcom/held).
//                              Bookings of tenants still served here run as before.
//   dedicated               -> a booking attributed to a tenant this deployment
//                              does not serve is refused, never written.
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get('x-cal-signature-256');
  if (!verifyCalcomSignature(raw, signature, process.env.CALCOM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let hook: CalcomWebhook;
  try {
    hook = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  if (hook.triggerEvent !== 'BOOKING_CREATED') {
    return NextResponse.json({ ok: true, ignored: hook.triggerEvent ?? null });
  }

  const payload = hook.payload ?? {};

  const tenancy = readTenancy();
  if (tenancy.mode === 'shared' && tenancy.moved.size > 0) {
    const routed = await routeForMovedTenants(raw, signature as string, hook, tenancy.moved);
    if (routed) return routed;
  } else if (tenancy.mode === 'dedicated') {
    let owners: CalcomOwners | null = null;
    try {
      owners = readCalcomOwners();
    } catch {
      // Bad owner config: this deployment's own table is the only one it can
      // touch, so carry on rather than lose the booking.
    }
    const owner = owners ? attributeBooking(payload, owners) : null;
    if (owner && !routeSession(owner, tenancy).served) {
      return NextResponse.json({ error: 'booking belongs to another deployment' }, { status: 404 });
    }
  }

  const { phone, email } = extractContact(payload);
  if (!phone && !email) {
    return NextResponse.json({ ok: true, matched: false, reason: 'no contact in payload' });
  }

  const supabase = createServiceClient();

  // Match by phone first (the reliable key the FR collects), then email as a fallback.
  // jc_sms_conversations has NO synthetic `id` column -- `from_number` (E.164) is the
  // table's natural key (matches the on_conflict target the FR/form-lead n8n upserts
  // use). cal.com's normalized attendee phone must compare against that column.
  let row: { from_number: string; status: string | null; calcom_booking_uid: string | null } | null = null;
  if (phone) {
    const { data } = await supabase
      .from('jc_sms_conversations')
      .select('from_number, status, calcom_booking_uid')
      .eq('from_number', phone)
      .maybeSingle();
    row = data ?? null;
  }
  if (!row && email) {
    try {
      const { data } = await supabase
        .from('jc_sms_conversations')
        .select('from_number, status, calcom_booking_uid')
        .eq('email', email)
        .maybeSingle();
      row = data ?? null;
    } catch {
      // email column may not exist in the FR-owned schema yet; phone is authoritative.
    }
  }

  if (!row) {
    return NextResponse.json({ ok: true, matched: false });
  }

  // Idempotent: cal.com can retry the same event; skip if already applied.
  if (payload.uid && row.calcom_booking_uid === payload.uid) {
    return NextResponse.json({ ok: true, matched: true, deduped: true });
  }

  const patch = buildBookingPatch(row.status, payload, new Date());
  const { error } = await supabase.from('jc_sms_conversations').update(patch).eq('from_number', row.from_number);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, matched: true, status: patch.status });
}

/**
 * Shared deployment with at least one moved tenant. Returns null when the
 * booking belongs to a tenant still served here (process it as before),
 * otherwise the response: forwarded, or held with a founder signal. Never
 * writes the booking to this deployment's data project.
 */
async function routeForMovedTenants(
  raw: string,
  signature: string,
  hook: CalcomWebhook,
  moved: ReadonlyMap<string, string>,
): Promise<NextResponse | null> {
  const payload = hook.payload ?? {};
  let owner: string | null = null;
  let reason = 'no configured event type or organizer matched';
  try {
    owner = attributeBooking(payload, readCalcomOwners());
  } catch {
    reason = 'booking owner config is invalid';
  }
  if (owner && !moved.has(owner)) return null;

  if (owner) {
    const forwarded = await forwardBooking(moved.get(owner) as string, raw, signature);
    if (forwarded.ok) return NextResponse.json({ ok: true, forwarded: true });
    reason = forwarded.detail;
  }

  const held = await holdBooking(createControlServiceClient(), {
    rawBody: raw,
    triggerEvent: hook.triggerEvent ?? null,
    bookingUid: typeof payload.uid === 'string' ? payload.uid : null,
    reason,
    targetSessionId: owner,
  });
  if (!held.held) {
    // Not stored: answer an error so the sender sees a failure (and may retry);
    // the founder signal above was still attempted.
    return NextResponse.json({ error: 'booking could not be held', alerted: held.alerted }, { status: 500 });
  }
  return NextResponse.json({ ok: true, held: true, duplicate: held.duplicate }, { status: 202 });
}
