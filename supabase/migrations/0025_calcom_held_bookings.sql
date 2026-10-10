-- 0025_calcom_held_bookings.sql
--
-- Control (main) project only. Holds cal.com bookings that a deployment would
-- not write: on the SHARED deployment, a moved client's booking that could not
-- be forwarded or attributed; on a DEDICATED deployment, any booking not
-- attributed to a session it serves (src/lib/calcom/held.ts). Each row keeps the exact signed body so it can be
-- replayed later (scripts/replay-held-calcom.mjs); nothing here is ever shown
-- to a client.
--
-- Must be applied before MATE_MOVED_SESSIONS is set on the shared deployment.
-- Until then the webhook answers 500 for an unroutable booking (and still
-- raises the founder signal), it never drops one silently.

create table if not exists public.calcom_held_bookings (
  id uuid primary key default gen_random_uuid(),
  -- 'uid:<trigger>:<booking uid>', or 'body:<sha256 of the signed body>' when
  -- the booking has no uid. One row per delivery, however often cal.com retries.
  dedupe_key text not null,
  received_at timestamptz not null default now(),
  trigger_event text,
  booking_uid text,
  reason text not null,
  target_session_id uuid,
  raw_body text not null,
  -- The delivery's founder alert: its outbound_texts.source.
  alert_key text not null,
  resolved_at timestamptz,
  resolution text
);

-- cal.com may deliver the same booking twice: hold it (and alert) once.
create unique index if not exists calcom_held_bookings_dedupe_key_uq
  on public.calcom_held_bookings (dedupe_key);

create index if not exists calcom_held_bookings_open_idx
  on public.calcom_held_bookings (received_at)
  where resolved_at is null;

-- Exactly-once founder alert per held delivery. The alert is an
-- outbound_texts row (amos table in this same project, delivered by the amos
-- router) whose source is the delivery's alert_key:
-- 'mate:calcom-held:<sha256 hex of dedupe_key>'. This index makes that source
-- unique, so the insert itself is the exactly-once gate: a second insert for the
-- same key (retry, concurrent or late delivery) fails with 23505, which the app
-- treats as "already queued". Scoped strictly to the Mate prefix: no other
-- outbound_texts source is affected. Checked before writing this (2026-10-10):
-- 0 existing rows match 'mate:%', so the index builds without conflicts.
create unique index if not exists outbound_texts_mate_calcom_held_source_uq
  on public.outbound_texts (source)
  where source like 'mate:calcom-held:%';

-- Server-side only: service role, no API access for anon or signed-in users.
-- Tables created through the Management API do not inherit PostgREST grants,
-- so grant explicitly.
alter table public.calcom_held_bookings enable row level security;
revoke all on table public.calcom_held_bookings from anon, authenticated;
grant all privileges on table public.calcom_held_bookings to service_role;

comment on table public.calcom_held_bookings is
  'cal.com bookings for a moved client that the shared Mate deployment could not forward or attribute. Contains booking PII; service role only.';
