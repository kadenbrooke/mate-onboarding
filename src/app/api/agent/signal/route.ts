import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { emitClientEvent } from '@/lib/agent/clientEvents';
import { handoffSignalEvent } from '@/lib/metrics/eventSources';

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
  const kind = url.searchParams.get('kind');
  if (!kind) return NextResponse.json({ error: 'kind required' }, { status: 400, headers: CORS });
  const supabase = createServiceClient();
  const sessionId = url.searchParams.get('session_id');
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
