import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { checkDashApiAccess } from '@/lib/portal/api-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { canUseLeadSnapshot } from '@/lib/leads/capability';

// POST /api/dash/<sessionId>/leads/manual
//
// Start a typed-in lead. Creates the same lead_snapshots row a photo would,
// with no image (storage_path 'typed'), so the confirm step, the consent
// record, the dedupe, and the rate limit are all shared with the photo flow.
// Nothing here creates a lead or sends anything: that is the confirm route.
//
// Spec: amos repo, projects/deployed/mate-onboarding/manual-lead-entry-spec.md

export const dynamic = 'force-dynamic';

/** Shared with photo uploads: same table, same window. */
const MAX_SNAPSHOTS_PER_HOUR = 20;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId: raw } = await params;
  const sessionId = resolveSessionId(raw);

  const verdict = await checkDashApiAccess(sessionId);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  const service = createServiceClient();
  const { data: session } = await service
    .from('onboarding_sessions')
    .select('id, is_demo, contact_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (session.is_demo) {
    return NextResponse.json({ error: 'Not available on the demo dashboard.' }, { status: 400 });
  }
  if (!session.contact_id) {
    return NextResponse.json({ error: 'Not enabled for this account.' }, { status: 403 });
  }
  const { data: caps } = await service
    .from('client_capabilities')
    .select('capability_key, status')
    .eq('contact_id', session.contact_id as string);
  if (!canUseLeadSnapshot(caps, verdict.access)) {
    return NextResponse.json({ error: 'Not enabled for this account.' }, { status: 403 });
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await service
    .from('lead_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .gte('created_at', hourAgo);
  if ((count ?? 0) >= MAX_SNAPSHOTS_PER_HOUR) {
    return NextResponse.json({ error: 'Too many in the last hour. Try again shortly.' }, { status: 429 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: snapshot, error } = await service
    .from('lead_snapshots')
    .insert({
      session_id: sessionId,
      uploaded_by: user?.id ?? null,
      storage_path: 'typed',
      status: 'ready',
      extracted: { candidates: [], unreadable: null, duplicates: [], typed: true },
    })
    .select('id')
    .single();
  if (error || !snapshot) {
    return NextResponse.json({ error: error?.message ?? 'could not start' }, { status: 500 });
  }

  return NextResponse.json({ snapshot_id: snapshot.id });
}
