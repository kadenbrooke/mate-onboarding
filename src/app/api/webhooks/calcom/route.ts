import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyCalcomSignature } from '@/lib/calcom/verify';
import { extractContact, buildBookingPatch, type CalcomWebhook } from '@/lib/calcom/booking';

export const runtime = 'nodejs';

// cal.com BOOKING_CREATED handler for the J&C Cultivator (cultivator-spec.md Piece 4).
// Matches the booking to a jc_sms_conversations row by phone/email, records the
// booking, exits any active drip, and stores the cal.com uid. Stub-safe: with no
// real cal.com event connected nothing fires, and an unmatched booking is a no-op.
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
  const { phone, email } = extractContact(payload);
  if (!phone && !email) {
    return NextResponse.json({ ok: true, matched: false, reason: 'no contact in payload' });
  }

  const supabase = createServiceClient();

  // Match by phone first (the reliable key the FR collects), then email as a fallback.
  // The FR keys conversations on `from_number` (E.164) — cal.com's normalized
  // attendee phone must compare against that column, not a non-existent `phone`.
  let row: { id: string; status: string | null; calcom_booking_uid: string | null } | null = null;
  if (phone) {
    const { data } = await supabase
      .from('jc_sms_conversations')
      .select('id, status, calcom_booking_uid')
      .eq('from_number', phone)
      .maybeSingle();
    row = data ?? null;
  }
  if (!row && email) {
    try {
      const { data } = await supabase
        .from('jc_sms_conversations')
        .select('id, status, calcom_booking_uid')
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
  const { error } = await supabase.from('jc_sms_conversations').update(patch).eq('id', row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, matched: true, status: patch.status });
}
