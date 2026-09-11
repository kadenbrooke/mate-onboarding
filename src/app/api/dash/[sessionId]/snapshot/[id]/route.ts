import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { checkDashApiAccess } from '@/lib/portal/api-gate';
import { resolveSessionId } from '@/lib/portal/demo';

// GET    /api/dash/<sessionId>/snapshot/<id>   read one snapshot's state
// DELETE /api/dash/<sessionId>/snapshot/<id>   discard it
//
// Both scope the row to the session as well as the id. Holding a snapshot
// UUID must not be enough to read another client's extracted lead details:
// the session gate proves who you are, the session_id filter proves the row is
// yours. Without the second half this is an IDOR on people's names and phone
// numbers.

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sessionId: string; id: string }> };

async function gate(rawSessionId: string) {
  const sessionId = resolveSessionId(rawSessionId);
  const verdict = await checkDashApiAccess(sessionId);
  return { sessionId, verdict };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { sessionId: raw, id } = await params;
  const { sessionId, verdict } = await gate(raw);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  const service = createServiceClient();
  const { data, error } = await service
    .from('lead_snapshots')
    .select('id, status, extracted, error, created_at, confirmed_at')
    .eq('id', id)
    .eq('session_id', sessionId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({
    snapshot_id: data.id,
    status: data.status,
    candidates: (data.extracted as { candidates?: unknown[] } | null)?.candidates ?? [],
    unreadable: (data.extracted as { unreadable?: string | null } | null)?.unreadable ?? null,
    error: data.error,
    created_at: data.created_at,
    confirmed_at: data.confirmed_at,
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { sessionId: raw, id } = await params;
  const { sessionId, verdict } = await gate(raw);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  const service = createServiceClient();

  // Status only, the row and its image stay. The image is the consent artifact
  // for anything already sent from this snapshot, and a discard is the human
  // saying "do not use these candidates", not "erase the evidence".
  const { data, error } = await service
    .from('lead_snapshots')
    .update({ status: 'discarded' })
    .eq('id', id)
    .eq('session_id', sessionId)
    // A confirmed snapshot has already produced leads. Discarding it would
    // misrepresent the record of what was sent, so it is refused.
    .neq('status', 'confirmed')
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found, or already confirmed' }, { status: 404 });

  return NextResponse.json({ snapshot_id: data.id, status: 'discarded' });
}
