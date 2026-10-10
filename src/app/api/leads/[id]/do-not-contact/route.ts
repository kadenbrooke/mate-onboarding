import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';
import { practiceStatus } from '@/lib/portal/practice';
import { intakeTenantFor } from '@/lib/leads/intakeTenants';
import { logMessage } from '@/lib/agent/messages';
import { normalizeJcConsentPhone } from '@/lib/leads/doNotContact';

// Record a spoken phone-call opt-out. The database RPC owns the J&C consent
// latch and audit event; Mate only records a human call note on the lead.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { session_id?: unknown };
  try { body = await request.json(); } catch { body = {}; }

  const claimed = body.session_id;
  const gate = await checkLeadApiAccess(id, typeof claimed === 'string' ? claimed : undefined);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (gate.access === 'demo') {
    return NextResponse.json({ error: 'do-not-contact is not recorded on demo dashboards' }, { status: 403 });
  }

  const supabase = createServiceClient();
  const practice = await practiceStatus(supabase, gate.lead.session_id);
  if (!practice.ok) return NextResponse.json({ error: practice.error }, { status: 500 });

  const { data: { user } } = await (await createClient()).auth.getUser();
  const recordedBy = user?.email?.trim();
  if (!recordedBy) return NextResponse.json({ error: 'signed-in user email required' }, { status: 500 });

  // Practice tenants are provider-free by definition. Keep the rehearsal
  // receipt in the normal lead thread, clearly marked as fake.
  if (practice.isPractice) {
    const note = await logMessage(supabase, {
      leadId: id, sessionId: gate.lead.session_id, direction: 'inbound', author: 'human', channel: 'call_note',
      body: `[Practice fake] Do not contact recorded from a phone call by ${recordedBy}.`,
    });
    if (note.error) return NextResponse.json({ error: note.error }, { status: 500 });
    return NextResponse.json({ ok: true, practice: true, fake: true, recorded_by: recordedBy, recorded_at: new Date().toISOString() });
  }

  // Refuse tenants that are not wired to this lane before reading their phone.
  if (!intakeTenantFor(gate.lead.session_id)) {
    return NextResponse.json({ error: 'do-not-contact is not enabled for this dashboard' }, { status: 403 });
  }

  // Phone is read only after tenant authorization and lane eligibility pass.
  const { data: contact, error: contactError } = await supabase.from('client_leads')
    .select('phone').eq('id', id).eq('session_id', gate.lead.session_id).maybeSingle();
  if (contactError) return NextResponse.json({ error: contactError.message }, { status: 500 });
  const phone = normalizeJcConsentPhone(typeof contact?.phone === 'string' ? contact.phone : null);
  if (!phone) return NextResponse.json({ error: 'lead has no valid phone number' }, { status: 422 });

  let result: { data: Array<{ event_id: string; normalized_phone: string }> | null; error: { message: string } | null };
  try {
    result = await supabase.rpc('jc_record_spoken_optout', { phone, recorded_by: recordedBy });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RPC call failed';
    return NextResponse.json({ error: `Opt-out could not be recorded: ${message}` }, { status: 502 });
  }
  const event = result.data?.[0];
  if (result.error || !event?.normalized_phone) {
    return NextResponse.json({ error: `Opt-out could not be recorded: ${result.error?.message ?? 'RPC returned no result'}` }, { status: 502 });
  }

  const note = await logMessage(supabase, {
    leadId: id, sessionId: gate.lead.session_id, direction: 'inbound', author: 'human', channel: 'call_note',
    body: `Do not contact recorded from a phone call by ${recordedBy}.`,
  });
  if (note.error) {
    return NextResponse.json({ error: `Opt-out was recorded, but Mate could not save the activity note: ${note.error}` }, { status: 500 });
  }
  return NextResponse.json({
    ok: true, event_id: event.event_id, normalized_phone: event.normalized_phone,
    recorded_by: recordedBy, recorded_at: new Date().toISOString(),
  });
}
