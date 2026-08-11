import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendSms } from '@/lib/agent/telnyx';
import { buildMenuText, classifyReply } from '@/lib/agent/postcall';
import { applyPostcallChoice } from '@/lib/agent/postcallActions';
import { applyQuoteOutcome } from '@/lib/agent/quoteOutcome';
import { logMessage } from '@/lib/agent/messages';
import { applyNoteToLead } from '@/lib/agent/noteExtract';

const DAY_MS = 24 * 60 * 60 * 1000;

// Auth: shared query token, same model as the Telnyx TeXML routes (unsigned webhooks).
function authed(params: URLSearchParams): boolean {
  const tok = process.env.AGENT_WEBHOOK_TOKEN;
  return !!tok && params.get('k') === tok;
}

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  if (!authed(params)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const action = params.get('action');
  let body: { session_id?: string; caller?: string; from?: string; text?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const supabase = createServiceClient();

  if (action === 'fire') {
    if (!body.session_id || !body.caller) return NextResponse.json({ error: 'session_id and caller required' }, { status: 400 });
    let { data: lead } = await supabase.from('client_leads')
      .select('id, session_id, phone').eq('session_id', body.session_id).eq('phone', body.caller).maybeSingle();
    // Provenance for the "4 / Ignore" path below: only a lead this call just
    // created may be deleted when the operator says to drop it. A repeat caller
    // with history is never removed.
    const createdByFire = !lead;
    if (!lead) {
      // This branch only reaches an INSERT on the answered-call path (voice workflow's
      // "If Answered Call" -> "Fire Postcall Menu"; a genuinely missed/no-answer call
      // never gets here, see JC Asphalt First Responder workflow). handler:'human' is
      // correct (a human picked up); source used to say 'missed_call' which was a
      // mislabel of this exact branch -- fixed to 'call' per the source taxonomy
      // (meta/call/text/referral/google).
      const ins = await supabase.from('client_leads')
        .insert({ session_id: body.session_id, phone: body.caller, source: 'call', handler: 'human' })
        .select('id, session_id, phone').single();
      lead = ins.data;
    }
    if (!lead) return NextResponse.json({ error: 'could not resolve lead' }, { status: 500 });
    const { data: config } = await supabase.from('onboarding_sessions')
      .select('operator_phone, onboarding_form_url, faq_url').eq('id', body.session_id).single();
    if (!config?.operator_phone) return NextResponse.json({ error: 'no operator_phone configured' }, { status: 409 });
    await supabase.from('lead_postcall').insert({
      lead_id: lead.id, session_id: body.session_id, status: 'awaiting', created_by_fire: createdByFire,
    });
    await sendSms(config.operator_phone, buildMenuText(body.caller));
    return NextResponse.json({ ok: true, lead_id: lead.id });
  }

  if (action === 'operator_reply') {
    if (!body.session_id || !body.text) return NextResponse.json({ error: 'session_id and text required' }, { status: 400 });
    const { data: pc } = await supabase.from('lead_postcall')
      .select('id, lead_id, kind, jc_conversation_id, created_by_fire').eq('session_id', body.session_id).eq('status', 'awaiting')
      .order('opened_at', { ascending: false }).limit(1).maybeSingle();
    if (!pc) return NextResponse.json({ ok: true, note: 'no open menu' });

    // Quote-outcome menu (J&C Cultivator) routes through applyQuoteOutcome, not the call menu.
    if (pc.kind === 'quote') {
      const { choice, notes } = classifyReply(body.text);
      // Notes are logged onto the lead_postcall row (a quote menu has no lead_messages row).
      const logNote = async (note: string) => {
        const { data: cur } = await supabase.from('lead_postcall').select('notes').eq('id', pc.id).single();
        const prev = cur?.notes ? `${cur.notes}\n` : '';
        await supabase.from('lead_postcall').update({ notes: `${prev}${note}` }).eq('id', pc.id);
      };
      if (choice) {
        await applyQuoteOutcome(choice, notes, { conversationId: pc.jc_conversation_id, supabase, logNote });
        if (choice === '4') {
          // Ignore: no state change, schedule one re-ask ~24h later, keep the menu open.
          await supabase.from('lead_postcall').update({ reask_at: new Date(Date.now() + DAY_MS).toISOString() }).eq('id', pc.id);
        } else {
          await supabase.from('lead_postcall').update({ status: 'resolved', choice, resolved_at: new Date().toISOString() }).eq('id', pc.id);
        }
      } else if (notes) {
        await logNote(notes);
      }
      return NextResponse.json({ ok: true, kind: 'quote' });
    }

    const { data: lead } = await supabase.from('client_leads')
      .select('id, session_id, phone').eq('id', pc.lead_id).single();
    const { data: config } = await supabase.from('onboarding_sessions')
      .select('onboarding_form_url, faq_url').eq('id', body.session_id).single();
    const { choice, notes } = classifyReply(body.text);

    // "4 / Ignore" on a lead this call just created means the caller was never
    // a lead (wrong number, a supplier, a callback). Drop the row instead of
    // leaving it in the pipeline. lead_messages and lead_postcall cascade off
    // client_leads, so the note logged below would go with it -- hence the
    // delete runs first and the note is skipped for a row that is going away.
    if (choice === '4' && lead && pc.created_by_fire) {
      const { error: delError } = await supabase.from('client_leads')
        .delete().eq('id', lead.id).eq('session_id', body.session_id);
      if (!delError) return NextResponse.json({ ok: true, ignored: true, deleted_lead: true });
      // Delete failed: fall through to the normal path rather than silently
      // losing the operator's reply.
    }

    if (notes && lead) {
      await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'inbound', author: 'human', channel: 'call_note', body: notes });
      // Best-effort enrichment: pull name/email/address/city/service/quote out
      // of the note into the lead's empty fields. Never blocks the reply.
      await applyNoteToLead(supabase, { leadId: lead.id, sessionId: lead.session_id, note: notes });
    }
    if (choice && lead) {
      await applyPostcallChoice(choice, { lead, config: config ?? {}, supabase, sendSms });
      await supabase.from('lead_postcall').update({ status: 'resolved', choice, resolved_at: new Date().toISOString() }).eq('id', pc.id);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
