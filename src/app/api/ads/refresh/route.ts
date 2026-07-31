import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { mapInsightsToRows } from '@/lib/metrics/ads';
import { metaConfig, fetchInsights } from '@/lib/metrics/adsFetch';

// Daily refresh of ad_metrics from the Meta Marketing API. Triggered by Vercel
// Cron (see vercel.json) which sends `Authorization: Bearer $CRON_SECRET`. Also
// accepts the manual ingest token (x-ingest-token) so it can be seeded/re-run
// by hand. No LLM involved -- pure fetch + upsert.
//
// The target session (J&C) is env-driven (META_JC_SESSION_ID); nothing about
// the account or session is hardcoded in the source.

export const dynamic = 'force-dynamic';

// There is deliberately no hardcoded session fallback here.
//
// This route used to default to a `DEFAULT_JC_SESSION` constant commented as
// "the J&C pilot session" whose UUID was in fact the public is_demo session.
// With META_JC_SESSION_ID unset, every pull silently wrote a paying client's
// ad data to a session that renders without authentication. Failing loudly is
// strictly better than writing client data to the wrong session.

function authorized(req: NextRequest): boolean {
  // Vercel Cron path: Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  // Manual/seed path: x-ingest-token matching LEADS_INGEST_TOKEN.
  const expected = process.env.LEADS_INGEST_TOKEN ?? '';
  const token = req.headers.get('x-ingest-token');
  if (token && expected) {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

async function runRefresh(): Promise<{ upserted: number; leads: number; spend_cents: number }> {
  const sessionId = process.env.META_JC_SESSION_ID;
  if (!sessionId) {
    throw new Error('META_JC_SESSION_ID is not set; refusing to guess a target session');
  }
  const cfg = metaConfig();
  const insights = await fetchInsights(cfg);

  // UTC day key for the snapshot -- matches the `date` column and the unique
  // (session, campaign, day) index so re-running the same day upserts.
  const datePulled = new Date().toISOString().slice(0, 10);
  const rows = mapInsightsToRows(insights, sessionId, datePulled);

  if (rows.length === 0) {
    return { upserted: 0, leads: 0, spend_cents: 0 };
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('ad_metrics')
    .upsert(rows, { onConflict: 'session_id,campaign_id,date_pulled' });
  if (error) throw new Error(`ad_metrics upsert failed: ${error.message}`);

  return {
    upserted: rows.length,
    leads: rows.reduce((a, r) => a + r.leads, 0),
    spend_cents: rows.reduce((a, r) => a + r.spend_cents, 0),
  };
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await runRefresh();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'refresh failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST supports manual seeding via curl.
export const GET = handle;
export const POST = handle;
