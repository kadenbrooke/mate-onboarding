-- DEL-6: Ad Performance zone -- Meta (Facebook) ad spend + cost-per-lead.
--
-- `ad_metrics` holds a per-campaign daily snapshot pulled from the Meta
-- Marketing API Insights endpoint (level=campaign). The Ad Performance zone on
-- the Mate dashboard reads the LATEST snapshot (most recent date_pulled) for a
-- session and shows total spend, total leads, blended cost-per-lead, and the
-- per-campaign breakdown.
--
-- Money is stored in whole cents (spend_cents, cpl_cents) to match every other
-- money column in this schema (quote_cents, won_cents, ...). Meta returns
-- dollars; the refresh route converts on the way in.
--
-- Session-anchored: session_id FKs onboarding_sessions, same pattern as the
-- other client_* zone tables (migrations 019-021). RLS is ON with no policies;
-- the service-role key (SUPABASE_SECRET_KEY) used by trusted server routes
-- bypasses RLS, the anon client 42501s. This mirrors the established Mate
-- pattern -- these tables are never client-written.
--
-- Idempotent: safe to re-run.

create table if not exists public.ad_metrics (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.onboarding_sessions(id) on delete cascade,
  campaign_id   text not null,
  campaign_name text not null default 'Campaign',
  spend_cents   integer not null default 0,
  impressions   integer not null default 0,
  clicks        integer not null default 0,
  leads         integer not null default 0,
  cpl_cents     integer not null default 0,      -- cost per lead; 0 when no leads
  date_pulled   date    not null,                -- UTC day the snapshot was taken
  raw           jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- One row per (session, campaign, day). Re-pulling the same day upserts.
create unique index if not exists ad_metrics_session_campaign_day_uq
  on public.ad_metrics (session_id, campaign_id, date_pulled);

-- Zone query pattern: latest snapshot for a session.
create index if not exists ad_metrics_session_date_idx
  on public.ad_metrics (session_id, date_pulled desc);

-- RLS on, no policies: only the service-role key reaches these rows.
alter table public.ad_metrics enable row level security;
