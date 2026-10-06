import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendSms } from '@/lib/agent/telnyx';
import { setHandler } from '@/lib/agent/handler';
import { logMessage } from '@/lib/agent/messages';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';
import { intakeTenantFor } from '@/lib/leads/intakeTenants';

// Human reply from the dashboard: send to the lead, log it, and auto-take-over
// (typing = takeover). This sends a real SMS, so the caller must be signed in
// and hold access to the lead's tenant (derived from the lead row, never from
// the body). Demo sessions and tenants not wired in intakeTenants never send.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { session_id?: string; text?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const gate = await checkLeadApiAccess(id, body.session_id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { lead, access } = gate;
  if (access === 'demo' || !intakeTenantFor(lead.session_id)) {
    return NextResponse.json({ error: 'replies are not enabled for this dashboard' }, { status: 403 });
  }

  // Phone is read only now that the caller is authorized for this tenant.
  const supabase = createServiceClient();
  const { data: contact } = await supabase.from('client_leads')
    .select('phone').eq('id', id).eq('session_id', lead.session_id).maybeSingle();
  if (!contact?.phone) return NextResponse.json({ error: 'lead not found or has no phone' }, { status: 404 });

  const sent = await sendSms(contact.phone, text);
  if (!sent.ok) return NextResponse.json({ error: sent.error ?? 'send failed' }, { status: 502 });

  const logRes = await logMessage(supabase, { leadId: id, sessionId: lead.session_id, direction: 'outbound', author: 'human', body: text });
  const flipRes = await setHandler(supabase, { leadId: id, sessionId: lead.session_id, handler: 'human', by: 'dashboard' });
  // The SMS already went out; a post-send DB write failure is non-fatal but must be observable.
  // We still return ok:true (do not fail the request over a bookkeeping miss), just surface it in logs.
  if (logRes.error || flipRes.error) console.warn('reply post-send write failed', { id, logErr: logRes.error, flipErr: flipRes.error });
  return NextResponse.json({ ok: true });
}
