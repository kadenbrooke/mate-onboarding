import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { unservedSessionResponse } from '@/lib/supabase/tenant-response';
import { readTenancy } from '@/lib/supabase/tenancy';
import { WRITES_DISABLED_ERROR, dataWritesEnabled } from '@/lib/supabase/write-gate';
import { emitClientEvent } from '@/lib/agent/clientEvents';
import { handoffSignalEvent } from '@/lib/metrics/eventSources';
import { practiceStatus } from '@/lib/portal/practice';

// One-shot signal from the e2e preview page (served cross-origin from amos-ui),
// e.g. "operator-flip ready". Params ride the query string so a no-cors POST
// from the static page lands without a preflight. Auth = a throwaway SIGNAL_TOKEN;
// the only action is recording intent, which the CEO loop then confirms + acts on.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const tok = process.env.SIGNAL_TOKEN;
  if (!tok || url.searchParams.get('k') !== tok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: CORS });
  }
  if (!dataWritesEnabled()) {
    return NextResponse.json({ error: WRITES_DISABLED_ERROR, writes: 'disabled' }, { status: 503, headers: CORS });
  }
  const kind = url.searchParams.get('kind');
  if (!kind) return NextResponse.json({ error: 'kind required' }, { status: 400, headers: CORS });
  const sessionId = url.searchParams.get('session_id');
  // Session-less signals are internal plumbing that belongs to the shared
  // deployment; a dedicated one records only its own sessions' signals.
  const unserved = sessionId
    ? unservedSessionResponse(request, sessionId)
    : readTenancy().mode === 'dedicated'
      ? NextResponse.json({ error: 'session_id required' }, { status: 404, headers: CORS })
      : null;
  if (unserved) return unserved;
  const supabase = createServiceClient();
  if (sessionId) {
    const practice = await practiceStatus(supabase, sessionId);
    if (!practice.ok) return NextResponse.json({ error: practice.error }, { status: 500, headers: CORS });
    if (practice.isPractice) {
      return NextResponse.json({ error: 'Practice tenants cannot trigger agent signals.' }, { status: 403, headers: CORS });
    }
  }
  // `.select().single()` only so the signal's id can key the ticker event.
  const { data: signal, error } = await supabase.from('handoff_signals').insert({
    session_id: sessionId,
    kind,
    note: url.searchParams.get('note'),
  }).select('id, created_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  // Mirror it into the client's activity feed when the signal describes a real
  // change of hands. This table is also the sink for internal readiness pings
  // from the e2e preview page, and handoffSignalEvent returns null for those,
  // so a client never sees one. Best effort either way: emitClientEvent cannot
  // throw, and the signal is already recorded above.
  await emitClientEvent(supabase, handoffSignalEvent({
    signalId: signal?.id as string,
    sessionId,
    kind,
    at: (signal?.created_at as string | null) ?? new Date().toISOString(),
  }));
  return NextResponse.json({ ok: true }, { headers: CORS });
}
