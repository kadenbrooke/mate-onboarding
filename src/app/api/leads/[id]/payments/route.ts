import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';
import { parsePaymentBody } from '@/lib/leads/outcome';

// Record one payment (or, with a negative amount, a refund or chargeback) on a
// won job: a row in the client_lead_payments ledger (migration 0021). Each
// payment keeps its own date, so the dashboard's 30-day ledger and partner
// refund-clawback math stay correct when a balance is paid in installments.
//
// Same bar as the outcome route: access to the lead's tenant (derived from the
// lead row, never the body), and never on a demo dashboard. The ledger's
// session_id is set by the DB from the lead, and its triggers refuse a
// payment on a job that is not won or one that would take the total below
// zero; the checks here only turn those into plain answers.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const parsed = parsePaymentBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const claimed = (body as { session_id?: unknown }).session_id;
  const gate = await checkLeadApiAccess(id, typeof claimed === 'string' ? claimed : undefined);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (gate.access === 'demo') {
    return NextResponse.json({ error: 'payments are not recorded on demo dashboards' }, { status: 403 });
  }

  const supabase = createServiceClient();
  const { data: lead, error: leadError } = await supabase.from('client_leads')
    .select('job_outcome').eq('id', id).eq('session_id', gate.lead.session_id).maybeSingle();
  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });
  if (lead?.job_outcome !== 'won') {
    return NextResponse.json({ error: 'Mark the job won before recording a payment.' }, { status: 409 });
  }

  const { data: { user } } = await (await createClient()).auth.getUser();

  const { error } = await supabase.from('client_lead_payments').insert({
    lead_id: id,
    session_id: gate.lead.session_id,
    amount_cents: parsed.values.amount_cents,
    paid_at: parsed.values.paid_at,
    recorded_by: user?.id ?? null,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === '23514' ? 409 : 500 });
  }
  return NextResponse.json({ ok: true });
}
