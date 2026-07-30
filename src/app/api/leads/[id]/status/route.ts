import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Real (non-demo) sessions require a signed-in user before any write; demo
// sessions stay anonymous for the public Instant Demo flow. Membership-binding
// (user owns THIS session) is Plan-3 hardening.
// status_updated_at is stamped by DB trigger trg_client_leads_status_ts.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { status?: string; session_id?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (!['open', 'won', 'lost'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'status must be open|won|lost' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Resolve the session to check is_demo before authorizing the write.
  const { data: sessionRow, error: sessionError } = await supabase
    .from('onboarding_sessions')
    .select('is_demo')
    .eq('id', body.session_id)
    .maybeSingle();

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!sessionRow) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  if (!sessionRow.is_demo) {
    const ssr = await createClient();
    const { data: { user } } = await ssr.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }

  const { error } = await supabase.from('client_leads')
    .update({ status: body.status })
    .eq('id', id).eq('session_id', body.session_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
