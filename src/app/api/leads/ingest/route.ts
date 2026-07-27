import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

const LEAD_FIELDS = [
  'name', 'phone', 'city', 'service', 'source', 'referrer_name', 'score', 'status',
  'quote_cents', 'contacted', 'after_hours', 'first_reply_seconds', 'created_at',
] as const;

function tokenValid(token: string | null): boolean {
  const expected = process.env.LEADS_INGEST_TOKEN ?? '';
  if (!token || !expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!tokenValid(request.headers.get('x-ingest-token'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { session_id?: string; leads?: Record<string, unknown>[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  if (!body.session_id || !Array.isArray(body.leads)) {
    return NextResponse.json({ error: 'session_id and leads[] required' }, { status: 400 });
  }

  const rows = body.leads.map((lead) => {
    const row: Record<string, unknown> = { session_id: body.session_id };
    for (const f of LEAD_FIELDS) {
      if (lead[f] !== undefined) row[f] = lead[f];
    }
    return row;
  });

  const { error } = await createServiceClient().from('client_leads').insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: rows.length });
}
