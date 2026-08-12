-- 0011_client_appointments_google.sql
--
-- Real Google Calendar events in the Calendar zone.
--
-- `client_appointments` shipped with no link back to a source system: the only
-- rows in it are the seeded demo session's, written once by
-- scripts/seed-demo-leads.mjs. Nothing populated it for a paying client, so a
-- connected client's Calendar zone rendered empty.
--
-- The Google Calendar sync (/api/calendar/sync, daily cron + a first pull from
-- the OAuth callback) upserts one row per calendar event, so the table needs a
-- stable per-event key to upsert ON. That is `google_event_id`: the Calendar
-- API's event id, which is stable across pulls and unique per expanded instance
-- of a recurring series (singleEvents=true).
--
-- WHY THE UNIQUE INDEX IS NOT PARTIAL
-- The pre-existing demo rows have no google_event_id, so the key must tolerate
-- nulls. A `where google_event_id is not null` partial index would do that, but
-- Postgres can only infer a PARTIAL unique index for ON CONFLICT when the
-- statement repeats the index predicate -- and PostgREST/supabase-js cannot
-- send one, so `.upsert(..., { onConflict: 'session_id,google_event_id' })`
-- would fail with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". A PLAIN unique index gets the same tolerance for free:
-- Postgres treats nulls as DISTINCT by default, so any number of rows may have
-- a null google_event_id while (session_id, <real id>) stays unique. The sync
-- only ever reads, updates or deletes rows whose google_event_id is NOT null,
-- so non-Google rows (demo seed, anything a human or another pipeline writes)
-- are untouched by it.
--
-- Idempotent: safe to re-run.

-- 1. Source key. Nullable: rows that did not come from Google keep a null.
alter table public.client_appointments
  add column if not exists google_event_id text;

-- 2. Idempotent upsert target. One row per (session, calendar event); re-running
--    the sync updates in place instead of duplicating. Nulls are distinct, so
--    the existing seeded rows do not collide with each other.
create unique index if not exists client_appointments_session_google_event_uq
  on public.client_appointments (session_id, google_event_id);

-- 3. Read + prune pattern: this session's appointments inside a date window
--    (the dashboard's month grid, and the sync's stale-row diff).
create index if not exists client_appointments_session_starts_idx
  on public.client_appointments (session_id, starts_at);

-- Grant table access to service_role (the sb_secret_ key maps to it). When this
-- migration is applied via the Management API (owner = postgres) the default
-- privilege grants Supabase normally auto-applies do NOT fire, so service_role
-- 42501s "permission denied" without this. That exact outage already happened
-- once on ad_metrics (migration 0005). Explicit, and harmless to re-run.
grant all on public.client_appointments to service_role;
