-- 0025_calcom_held_bookings.sql
--
-- Control (main) project only. Holds cal.com bookings that reached the SHARED
-- deployment for a client that has moved to its own deployment, when the
-- booking could not be forwarded or could not be attributed to a tenant
-- (src/lib/calcom/held.ts). Each row keeps the exact signed body so it can be
-- replayed later (scripts/replay-held-calcom.mjs); nothing here is ever shown
-- to a client.
--
-- Must be applied before MATE_MOVED_SESSIONS is set on the shared deployment.
-- Until then the shared webhook answers 500 for an unroutable booking (and
-- still raises the founder signal), it never drops one silently.

create table if not exists public.calcom_held_bookings (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  trigger_event text,
  booking_uid text,
  reason text not null,
  target_session_id uuid,
  raw_body text not null,
  resolved_at timestamptz,
  resolution text
);

-- cal.com may deliver the same booking twice: hold it (and alert) once.
create unique index if not exists calcom_held_bookings_uid_trigger_uq
  on public.calcom_held_bookings (booking_uid, trigger_event)
  where booking_uid is not null;

create index if not exists calcom_held_bookings_open_idx
  on public.calcom_held_bookings (received_at)
  where resolved_at is null;

-- Server-side only: service role, no API access for anon or signed-in users.
-- Tables created through the Management API do not inherit PostgREST grants,
-- so grant explicitly.
alter table public.calcom_held_bookings enable row level security;
revoke all on table public.calcom_held_bookings from anon, authenticated;
grant all privileges on table public.calcom_held_bookings to service_role;

comment on table public.calcom_held_bookings is
  'cal.com bookings for a moved client that the shared Mate deployment could not forward or attribute. Contains booking PII; service role only.';
