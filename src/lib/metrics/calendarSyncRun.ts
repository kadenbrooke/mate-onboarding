// src/lib/metrics/calendarSyncRun.ts
//
// Orchestration for the Google Calendar -> client_appointments sync: read the
// connection, pull, map, write. Kept out of the route file so BOTH callers can
// use it -- the cron route (/api/calendar/sync) and the OAuth callback, which
// kicks a first pull so a client who just connected sees their calendar
// immediately instead of waiting for tomorrow's cron.
//
// Multi-tenant discipline: every read, upsert and delete below is filtered by
// session_id. A session can never see or clobber another session's rows.
//
// Never throws. Every failure comes back as a result row, so one client's
// expired token cannot stop the rest of the run.

import { createServiceClient } from '@/lib/supabase/service';
import { googleOAuthConfig, calendarAccessToken, fetchCalendarEvents } from './calendarFetch';
import { mapEventsToRows, syncWindow, type AppointmentRow } from './calendarSync';

export type CalendarSyncResult = {
  session_id: string;
  /** ok = pulled and wrote; skipped = nothing to do (no connection / no OAuth
   *  app configured); error = the pull or the write failed. */
  status: 'ok' | 'skipped' | 'error';
  upserted: number;
  removed: number;
  detail?: string;
};

/** Conflict target for the idempotent upsert. Matches the unique index
 *  client_appointments_session_google_event_uq (migration 0011). Re-running the
 *  sync updates the same row instead of inserting a duplicate. */
const CONFLICT_TARGET = 'session_id,google_event_id';

type ExistingRow = { id: string; google_event_id: string | null };

/**
 * Sync ONE session's calendar.
 *
 * `refreshToken` is optional: the OAuth callback already holds it in memory and
 * passes it straight through (saving a read), while the cron reads it from the
 * server-only onboarding_sessions.google_token_ref column. Either way the token
 * stays server-side and is never logged or returned.
 */
export async function syncSessionCalendar(
  sessionId: string,
  refreshToken?: string | null,
): Promise<CalendarSyncResult> {
  const base = { session_id: sessionId, upserted: 0, removed: 0 };

  try {
    const cfg = googleOAuthConfig();
    // No OAuth app configured: nothing is connected, so nothing to pull. This
    // is a state, not a failure.
    if (!cfg) return { ...base, status: 'skipped', detail: 'oauth not configured' };

    const supabase = createServiceClient();

    let token = refreshToken ?? null;
    if (!token) {
      const { data, error } = await supabase
        .from('onboarding_sessions')
        .select('google_token_ref')
        .eq('id', sessionId)
        .maybeSingle();
      if (error) throw new Error(`session lookup failed: ${error.message}`);
      token = (data?.google_token_ref as string | null) ?? null;
    }
    if (!token) return { ...base, status: 'skipped', detail: 'no google connection' };

    const window = syncWindow();
    const accessToken = await calendarAccessToken(token, cfg);
    const events = await fetchCalendarEvents(accessToken, window);
    const { rows, cancelledIds } = mapEventsToRows(events, sessionId);

    let upserted = 0;
    if (rows.length > 0) {
      const { error } = await supabase
        .from('client_appointments')
        .upsert(rows, { onConflict: CONFLICT_TARGET });
      if (error) throw new Error(`client_appointments upsert failed: ${error.message}`);
      upserted = rows.length;
    }

    const removed = await pruneStale(supabase, sessionId, window, rows, cancelledIds);

    return { session_id: sessionId, status: 'ok', upserted, removed };
  } catch (err) {
    return { ...base, status: 'error', detail: err instanceof Error ? err.message : 'sync failed' };
  }
}

/**
 * Delete rows for events that are no longer on the calendar: explicitly
 * cancelled instances, plus anything we previously wrote inside the window that
 * Google did not return this time (deleted or moved out).
 *
 * Two hard constraints:
 *  - Only rows with a non-null google_event_id are candidates. The seeded demo
 *    appointments (and any row a human or another pipeline writes) have a null
 *    google_event_id and are invisible to this function.
 *  - Deletes are keyed on the row's own uuid AND re-filtered by session_id, so
 *    a bad id can never reach another tenant's data.
 */
async function pruneStale(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  window: { timeMin: string; timeMax: string },
  rows: AppointmentRow[],
  cancelledIds: string[],
): Promise<number> {
  const { data, error } = await supabase
    .from('client_appointments')
    .select('id, google_event_id')
    .eq('session_id', sessionId)
    .not('google_event_id', 'is', null)
    .gte('starts_at', window.timeMin)
    .lte('starts_at', window.timeMax);

  // A prune failure is not worth failing the whole sync: the fresh rows are
  // already written and the next run retries the cleanup.
  if (error || !data) return 0;

  const live = new Set(rows.map((r) => r.google_event_id));
  const cancelled = new Set(cancelledIds);
  const staleIds = (data as ExistingRow[])
    .filter((r) => r.google_event_id !== null && (cancelled.has(r.google_event_id) || !live.has(r.google_event_id)))
    .map((r) => r.id);

  if (staleIds.length === 0) return 0;

  const { error: delError } = await supabase
    .from('client_appointments')
    .delete()
    .eq('session_id', sessionId) // belt and braces: uuids are already unique
    .in('id', staleIds);
  if (delError) return 0;

  return staleIds.length;
}

/**
 * Sync every session that has a Google connection. Failures are isolated per
 * session -- one client's revoked token must not stop another client's calendar
 * from refreshing.
 */
export async function syncAllCalendars(): Promise<CalendarSyncResult[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select('id, google_token_ref')
    .not('google_token_ref', 'is', null);

  if (error) throw new Error(`session scan failed: ${error.message}`);

  const sessions = (data ?? []) as { id: string; google_token_ref: string | null }[];
  return Promise.all(
    sessions.map((s) => syncSessionCalendar(s.id, s.google_token_ref)),
  );
}
