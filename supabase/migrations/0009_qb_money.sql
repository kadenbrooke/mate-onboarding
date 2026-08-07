-- DEL-10: Money zone -- QuickBooks Online (QBO) read-only financials.
--
-- Two tables, both session-anchored exactly like ad_metrics (migration 0005):
--
--   qb_connections -- per-client QBO OAuth state (realm + rotating tokens). One
--     row per session. Tokens are secrets: only the service-role key ever reads
--     this table (RLS on, no policies). Written/rotated by the KVM2 n8n rail,
--     which is the only surface that talks to Intuit (static whitelisted IP).
--
--   qb_metrics -- per-client daily financial snapshot pulled from the QBO P&L
--     report + Invoice/Payment queries: revenue, accounts-receivable (invoices
--     outstanding), collected-this-month, and expenses. The Money zone on the
--     Mate dashboard reads the LATEST snapshot for a session.
--
-- NOTE on the anchor column: the DEL-10 brief said `client_id`, but this app
-- has no clients table -- every per-client dashboard table (ad_metrics,
-- client_leads, client_events, ...) anchors on session_id -> onboarding_sessions.
-- The "client" IS the session (J&C's dash is /dash/<session-uuid>). Anchoring on
-- session_id keeps tenant isolation identical to every other zone and lets the
-- Money zone read exactly like the Ad Performance zone. Flagged in the PR.
--
-- Money is stored in whole cents to match every other money column in this
-- schema (spend_cents, quote_cents, won_cents, ...). QBO returns dollars; the
-- pull converts on the way in.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- qb_connections -- OAuth tokens + realm, per session. SECRETS TABLE.
-- ---------------------------------------------------------------------------
create table if not exists public.qb_connections (
  id                        uuid primary key default gen_random_uuid(),
  session_id                uuid not null references public.onboarding_sessions(id) on delete cascade,
  realm_id                  text not null,                       -- QBO company (realm) id
  environment               text not null default 'sandbox',     -- sandbox | production
  access_token              text,                                -- ~1h TTL bearer
  access_token_expires_at   timestamptz,
  refresh_token             text,                                -- ROTATES on every refresh (~100d life)
  refresh_token_expires_at  timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- One QBO connection per session. Re-connecting upserts on this key.
create unique index if not exists qb_connections_session_uq
  on public.qb_connections (session_id);

-- Constrain environment to the two the code knows, so a bad value fails loudly
-- at write time instead of silently pointing the pull at the wrong base URL.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qb_connections_environment_chk'
  ) then
    alter table public.qb_connections
      add constraint qb_connections_environment_chk
      check (environment in ('sandbox', 'production'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- qb_metrics -- daily financial snapshot, per session.
-- ---------------------------------------------------------------------------
create table if not exists public.qb_metrics (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.onboarding_sessions(id) on delete cascade,
  period                text not null,                 -- reporting month key, YYYY-MM (UTC)
  period_start          date,                          -- inclusive P&L period start
  period_end            date,                          -- inclusive P&L period end
  revenue_cents         integer not null default 0,    -- P&L total income for the period
  expenses_cents        integer not null default 0,    -- P&L total expenses (0 if not pulled)
  ar_cents              integer not null default 0,    -- invoices outstanding / accounts receivable
  invoices_outstanding  integer not null default 0,    -- count of open invoices
  collected_cents       integer not null default 0,    -- payments received this month
  date_pulled           date    not null,              -- UTC day the snapshot was taken
  raw                   jsonb   not null default '{}'::jsonb,
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

-- One row per (session, period, day). Re-pulling the same day upserts.
create unique index if not exists qb_metrics_session_period_day_uq
  on public.qb_metrics (session_id, period, date_pulled);

-- Zone query pattern: latest snapshot for a session.
create index if not exists qb_metrics_session_date_idx
  on public.qb_metrics (session_id, date_pulled desc);

-- ---------------------------------------------------------------------------
-- RLS + grants. Both tables: RLS on, no policies -> only the service-role key
-- (sb_secret_) reaches these rows; the anon client 42501s. Same locked pattern
-- as ad_metrics.
--
-- CRITICAL (the 42501 that bit migration 0005): when applied via the Management
-- API the owner is `postgres`, so Supabase's automatic service_role grants on
-- new public tables do NOT fire. Grant explicitly, including sequences, or every
-- service-role read/write gets "permission denied for table".
-- ---------------------------------------------------------------------------
alter table public.qb_connections enable row level security;
alter table public.qb_metrics     enable row level security;

grant all on public.qb_connections to service_role;
grant all on public.qb_metrics     to service_role;

-- No SERIAL/identity columns here (uuid PKs via gen_random_uuid), so there are
-- no owned sequences to grant. Kept explicit for the next author: if you add a
-- bigserial column, add `grant usage, select on sequence ... to service_role;`.
