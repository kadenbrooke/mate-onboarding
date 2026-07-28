import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

// Session UUID doubles as the bearer here, same trust model as the portal
// (signed-cookie hardening is tracked as Phase 3 in the Mate roadmap).
// status_updated_at is stamped by DB trigger trg_client_leads_status_ts.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { status?: string; session_id?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (!['open', 'won', 'lost'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'status must be open|won|lost' }, { status: 400 });
  }
  const { error } = await createServiceClient().from('client_leads')
    .update({ status: body.status })
    .eq('id', id).eq('session_id', body.session_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
