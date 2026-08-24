import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { checkDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';

// GET /api/dash/<sessionId>/events?since=<iso>
//
// Feeds the Ticker's poll. The dash page server-renders the newest 50 events
// once; without this the strip is frozen at whatever was true when the tab
// loaded, so "a new event pushes the rest right" could never actually fire.
//
// Returns ONLY events strictly newer than `since`, newest first. The client
// sends the created_at it already holds at the left edge, so a quiet client
// gets `{ events: [] }` back and costs one indexed range scan.
//
// Gated by checkDashAccess, the same verdict the page itself uses: a demo
// session is public, a real one needs membership or internal access. Without
// that this would be an unauthenticated read of any client's activity feed by
// session UUID.

export const dynamic = 'force-dynamic';

/** Matches the page's Ticker fetch; a burst of activity between polls is
 *  capped rather than dumping an unbounded batch into the strip. */
const MAX_ROWS = 50;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId: rawSessionId } = await params;
  const sessionId = resolveSessionId(rawSessionId);

  const access = await checkDashAccess(rawSessionId);
  if (access === 'not-found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access === 'login') return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (access === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const since = req.nextUrl.searchParams.get('since');
  // A missing or unparseable `since` is a client bug, not a reason to hand back
  // the whole feed: an unbounded response would push 50 chips into the strip at
  // once. Reject it and let the client keep what it has.
  if (!since) return NextResponse.json({ error: 'since is required' }, { status: 400 });
  const sinceMs = new Date(since).getTime();
  if (Number.isNaN(sinceMs)) {
    return NextResponse.json({ error: 'since must be an ISO timestamp' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('client_events')
    .select('id, agent, kind, message, created_at, source_key')
    .eq('session_id', sessionId)
    .gt('created_at', new Date(sinceMs).toISOString())
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: 'Could not load events' }, { status: 500 });
  }

  return NextResponse.json(
    { events: data ?? [] },
    { headers: { 'cache-control': 'no-store' } },
  );
}
