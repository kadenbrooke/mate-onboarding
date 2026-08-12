import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { syncAllCalendars, syncSessionCalendar, type CalendarSyncResult } from '@/lib/metrics/calendarSyncRun';

// Daily refresh of client_appointments from each connected client's Google
// Calendar. Triggered by Vercel Cron (see vercel.json) which sends
// `Authorization: Bearer $CRON_SECRET`. Also accepts the manual ingest token
// (x-ingest-token) so it can be seeded or re-run by hand. Same auth shape as
// /api/ads/refresh -- no LLM involved, pure fetch + upsert.
//
// Nothing about any client is hardcoded here: the route scans
// onboarding_sessions for rows that carry a google_token_ref, so a session is
// synced exactly when its owner has consented. `?sessionId=` narrows a run to
// one session (used by the OAuth callback's first-pull kick and for manual
// re-runs); it still requires the same authorization.
//
// Per-session failures are isolated the way per-platform failures are in the
// ads refresh: one client's revoked token reports as an error on its own line
// and the rest of the run still writes. Only a TOTAL failure is a 500.

export const dynamic = 'force-dynamic';

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

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get('sessionId');

  try {
    const sessions: CalendarSyncResult[] = sessionId
      ? [await syncSessionCalendar(sessionId)]
      : await syncAllCalendars();

    const attempted = sessions.filter((s) => s.status !== 'skipped');
    const allFailed = attempted.length > 0 && attempted.every((s) => s.status === 'error');

    return NextResponse.json(
      {
        ok: !allFailed,
        sessions,
        upserted: sessions.reduce((a, s) => a + s.upserted, 0),
        removed: sessions.reduce((a, s) => a + s.removed, 0),
      },
      { status: allFailed ? 500 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'calendar sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST supports manual runs via curl.
export const GET = handle;
export const POST = handle;
