import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

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
  const { error } = await createServiceClient().from('handoff_signals').insert({
    session_id: url.searchParams.get('session_id'),
    kind,
    note: url.searchParams.get('note'),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  return NextResponse.json({ ok: true }, { headers: CORS });
}
