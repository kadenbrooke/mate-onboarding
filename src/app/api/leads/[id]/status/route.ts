import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { PIPELINE_STATUSES } from '@/lib/metrics/leads';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';

// The caller must hold access to the lead's tenant (membership / internal);
// demo sessions stay open for the public Instant Demo flow. The tenant is the
// lead row's session, never the body's session_id.
// status_updated_at is stamped by DB trigger trg_client_leads_status_ts.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { status?: string; session_id?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!(PIPELINE_STATUSES as readonly string[]).includes(body.status ?? '')) {
    return NextResponse.json({ error: `status must be ${PIPELINE_STATUSES.join('|')}` }, { status: 400 });
  }

  const gate = await checkLeadApiAccess(id, body.session_id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { error } = await createServiceClient().from('client_leads')
    .update({ status: body.status })
    .eq('id', id).eq('session_id', gate.lead.session_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
