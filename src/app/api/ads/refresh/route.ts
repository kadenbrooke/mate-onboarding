import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { mapInsightsToRows, mapGoogleRowsToRows, type AdMetricRow } from '@/lib/metrics/ads';
import { metaConfig, fetchInsights } from '@/lib/metrics/adsFetch';
import { googleAdsConfig, fetchGoogleAdsCampaigns } from '@/lib/metrics/googleAdsFetch';

// Daily refresh of ad_metrics for EVERY configured ad platform. Triggered by
// Vercel Cron (see vercel.json) which sends `Authorization: Bearer $CRON_SECRET`.
// Also accepts the manual ingest token (x-ingest-token) so it can be seeded or
// re-run by hand. No LLM involved -- pure fetch + upsert.
//
// The target session (J&C) is env-driven (META_JC_SESSION_ID); nothing about
// the account or session is hardcoded in the source.
//
// Platforms are pulled INDEPENDENTLY and their failures are isolated: a broken
// Google developer token must not stop Meta's numbers from refreshing on the
// client's dashboard. Each platform reports its own status in the response, and
// the route only 500s when EVERY configured platform failed -- a partial
// success still wrote real data and should not read as a total outage.

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

type PlatformResult = {
  platform: 'meta' | 'google';
  status: 'ok' | 'skipped' | 'error';
  upserted: number;
  leads: number;
  spend_cents: number;
  detail?: string;
};

/** Pull one platform and upsert its rows. Never throws -- returns a result. */
async function runPlatform(
  platform: 'meta' | 'google',
  sessionId: string,
  datePulled: string,
  fetchRows: () => Promise<AdMetricRow[] | null>,
): Promise<PlatformResult> {
  const empty = { platform, upserted: 0, leads: 0, spend_cents: 0 };
  try {
    const rows = await fetchRows();
    // null = platform not configured yet. Distinct from "configured and
    // returned nothing", which is a real zero worth writing.
    if (rows === null) return { ...empty, status: 'skipped', detail: 'not configured' };
    if (rows.length === 0) return { ...empty, status: 'ok' };

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('ad_metrics')
      .upsert(rows, { onConflict: 'session_id,platform,campaign_id,date_pulled' });
    if (error) throw new Error(`ad_metrics upsert failed: ${error.message}`);

    return {
      platform,
      status: 'ok',
      upserted: rows.length,
      leads: rows.reduce((a, r) => a + r.leads, 0),
      spend_cents: rows.reduce((a, r) => a + r.spend_cents, 0),
    };
  } catch (err) {
    return { ...empty, status: 'error', detail: err instanceof Error ? err.message : 'failed' };
  }
}

async function runRefresh(): Promise<{ platforms: PlatformResult[]; leads: number; spend_cents: number }> {
  // No hardcoded demo-session fallback (see header comment): refuse to guess a
  // target rather than risk writing a paying client's ad data to the public
  // is_demo session. This preserves PR #2's security fix on top of the
  // multi-platform refresh.
  const sessionId = process.env.META_JC_SESSION_ID;
  if (!sessionId) {
    throw new Error('META_JC_SESSION_ID is not set; refusing to guess a target session');
  }

  // UTC day key for the snapshot -- matches the `date_pulled` column and the
  // unique (session, platform, campaign, day) index so re-running upserts.
  const datePulled = new Date().toISOString().slice(0, 10);

  const platforms = await Promise.all([
    runPlatform('meta', sessionId, datePulled, async () => {
      const insights = await fetchInsights(metaConfig());
      return mapInsightsToRows(insights, sessionId, datePulled);
    }),
    runPlatform('google', sessionId, datePulled, async () => {
      const cfg = googleAdsConfig();
      if (!cfg) return null; // no developer token yet -- skip, do not fail
      const resp = await fetchGoogleAdsCampaigns(cfg);
      return mapGoogleRowsToRows(resp, sessionId, datePulled);
    }),
  ]);

  return {
    platforms,
    leads: platforms.reduce((a, p) => a + p.leads, 0),
    spend_cents: platforms.reduce((a, p) => a + p.spend_cents, 0),
  };
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await runRefresh();
    // Only a TOTAL failure is a 500. If Meta wrote and Google errored, the
    // dashboard has fresh data and the cron should not be marked failed --
    // the per-platform detail carries the error for whoever reads the log.
    const attempted = result.platforms.filter((p) => p.status !== 'skipped');
    const allFailed = attempted.length > 0 && attempted.every((p) => p.status === 'error');
    return NextResponse.json({ ok: !allFailed, ...result }, { status: allFailed ? 500 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'refresh failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST supports manual seeding via curl.
export const GET = handle;
export const POST = handle;
