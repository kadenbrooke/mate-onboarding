import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendSms } from '@/lib/agent/telnyx';
import { setHandler } from '@/lib/agent/handler';
import { logMessage } from '@/lib/agent/messages';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';
import { intakeTenantFor } from '@/lib/leads/intakeTenants';
import { fakePracticeMessage, practiceStatus } from '@/lib/portal/practice';
import { isOptedOut, normalizeJcConsentPhone } from '@/lib/leads/doNotContact';

// Human reply from the dashboard: send to the lead, log it, and auto-take-over
// (typing = takeover). Practice tenants never reach a provider. They log a
// marked fake receipt so Aranza can rehearse the workflow safely.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { session_id?: string; text?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const gate = await checkLeadApiAccess(id, body.session_id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { lead, access } = gate;
  const supabase = createServiceClient();
  const practice = await practiceStatus(supabase, lead.session_id);
  if (!practice.ok) return NextResponse.json({ error: practice.error }, { status: 500 });
  if (access === 'demo' || (!practice.isPractice && !intakeTenantFor(lead.session_id))) {
    return NextResponse.json({ error: 'replies are not enabled for this dashboard' }, { status: 403 });
  }

  // Phone is read only now that the caller is authorized for this tenant.
  const { data: contact } = await supabase.from('client_leads')
    .select('phone').eq('id', id).eq('session_id', lead.session_id).maybeSingle();
  if (!contact?.phone) return NextResponse.json({ error: 'lead not found or has no phone' }, { status: 404 });

  if (intakeTenantFor(lead.session_id) && !normalizeJcConsentPhone(contact.phone)) {
    return NextResponse.json({ error: 'This lead has no valid J&C phone number; sending is blocked.' }, { status: 409 });
  }

  // The provider's STOP filter is not enough: spoken opt-outs and any live
  // latch read failure must stop Mate's own send path before it can take over.
  if (await isOptedOut(supabase, lead.session_id, contact.phone, { leadId: id, isPractice: practice.isPractice })) {
    return NextResponse.json({ error: "This lead asked not to be contacted, or opt-out status couldn't be checked; sending is blocked. Refresh to retry." }, { status: 409 });
  }

  const sent = practice.isPractice
    ? { ok: true, practice: true, error: undefined }
    : await sendSms(contact.phone, text);
  if (!sent.ok) return NextResponse.json({ error: sent.error ?? 'send failed' }, { status: 502 });

  const logRes = await logMessage(supabase, {
    leadId: id, sessionId: lead.session_id, direction: 'outbound', author: 'human',
    body: practice.isPractice ? fakePracticeMessage(text) : text,
  });
  const flipRes = await setHandler(supabase, { leadId: id, sessionId: lead.session_id, handler: 'human', by: 'dashboard' });
  // The SMS already went out; a post-send DB write failure is non-fatal but must be observable.
  // We still return ok:true (do not fail the request over a bookkeeping miss), just surface it in logs.
  if (logRes.error || flipRes.error) console.warn('reply post-send write failed', { id, logErr: logRes.error, flipErr: flipRes.error });
  return NextResponse.json({ ok: true, practice: practice.isPractice });
}
