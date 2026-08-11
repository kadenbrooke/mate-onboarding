import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { checkDashApiAccess } from '@/lib/portal/api-gate';

// Hard-delete a lead from the pipeline. Destructive and irreversible, so the
// caller must actually hold access to the session (membership / internal /
// demo), not merely know its UUID. lead_messages and lead_postcall both carry
// ON DELETE CASCADE on lead_id, so the thread and any open operator menu go
// with the row and nothing is left orphaned.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const verdict = await checkDashApiAccess(sessionId);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  // session_id in the filter keeps a valid session's credentials from reaching
  // another tenant's lead row.
  const { error, count } = await createServiceClient()
    .from('client_leads')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('session_id', sessionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
