import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';
import { parseOutcomeBody } from '@/lib/leads/outcome';

// Record (or clear) a lead's job outcome: won or lost, the sold price, and the
// cash collected so far (migration 0021). These numbers are the basis of the
// partner revenue share, so the caller must hold access to the lead's tenant
// (derived from the lead row, never the body), and demo dashboards never
// write: unlike pipeline status, nothing about a demo needs a recorded sale.
//
// The write replaces all outcome fields at once, so a lead never carries a
// half-old, half-new outcome. outcome_at / collected_at are stamped by the DB
// trigger trg_client_leads_outcome_ts. `status` is deliberately untouched: the
// Meta Conversions sweeps key on it.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const parsed = parseOutcomeBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const claimed = (body as { session_id?: unknown }).session_id;
  const gate = await checkLeadApiAccess(id, typeof claimed === 'string' ? claimed : undefined);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (gate.access === 'demo') {
    return NextResponse.json({ error: 'job outcomes are not recorded on demo dashboards' }, { status: 403 });
  }

  // Who entered it. The gate already required a signed-in member / internal
  // user for a non-demo tenant; this only reads their id for the audit field.
  const { data: { user } } = await (await createClient()).auth.getUser();

  const { error } = await createServiceClient().from('client_leads')
    .update({ ...parsed.values, outcome_recorded_by: parsed.values.job_outcome ? user?.id ?? null : null })
    .eq('id', id).eq('session_id', gate.lead.session_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
