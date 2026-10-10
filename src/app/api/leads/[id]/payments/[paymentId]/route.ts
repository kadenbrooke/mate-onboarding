import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { refuseIfWritesDisabled } from '@/lib/supabase/write-gate';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';

// Remove one mistyped payment from a lead's ledger (payments are never
// edited: remove and enter again, so each row's recorded_by stays true).
// Same bar as recording one. Scoped by payment id AND lead id AND the lead
// row's tenant, so a payment id from another lead or tenant matches nothing.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const writesOff = refuseIfWritesDisabled();
  if (writesOff) return writesOff;
  const { id, paymentId } = await params;
  const claimed = new URL(request.url).searchParams.get('session_id');

  const gate = await checkLeadApiAccess(id, claimed);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (gate.access === 'demo') {
    return NextResponse.json({ error: 'payments are not recorded on demo dashboards' }, { status: 403 });
  }

  const { error, count } = await createServiceClient().from('client_lead_payments')
    .delete({ count: 'exact' })
    .eq('id', paymentId).eq('lead_id', id).eq('session_id', gate.lead.session_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === '23514' ? 409 : 500 });
  }
  if (!count) return NextResponse.json({ error: 'payment not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
