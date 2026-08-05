-- DEL-8: multi-platform Ad Performance -- Google Ads alongside Meta on ONE card.
--
-- `ad_metrics` shipped Meta-only (migration 0005). The founder's call is that
-- Google and Meta share a single Ad Performance zone rather than each getting
-- their own card, so the table grows a `platform` discriminator instead of a
-- parallel google_ad_metrics table. One table keeps the blended cost-per-lead
-- (total spend across BOTH platforms / total leads) a plain SUM, which is the
-- number the client actually cares about.
--
-- Why the unique index has to change: campaign_id is only unique WITHIN a
-- platform. Meta campaign ids are numeric strings and so are Google's, so
-- without platform in the key a Google campaign could collide with a Meta one
-- and silently overwrite it on upsert.
--
-- Existing rows are all Meta by construction (0005 was the Meta-only shipping
-- state), so the default backfills them correctly.
--
-- Idempotent: safe to re-run.

-- 1. Discriminator. Default 'meta' backfills every pre-existing row.
alter table public.ad_metrics
  add column if not exists platform text not null default 'meta';

-- Constrain to the platforms the refresh route knows how to pull. Adding a
-- platform later means editing this constraint -- deliberate, so an unknown
-- value fails loudly at write time instead of rendering as a mystery segment.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ad_metrics_platform_chk'
  ) then
    alter table public.ad_metrics
      add constraint ad_metrics_platform_chk
      check (platform in ('meta', 'google'));
  end if;
end $$;

-- 2. Rekey. The old (session, campaign, day) index cannot coexist with two
-- platforms; drop it and rebuild including platform. Upserts in the refresh
-- route target this index via on_conflict, so the column order matters.
drop index if exists public.ad_metrics_session_campaign_day_uq;

create unique index if not exists ad_metrics_session_platform_campaign_day_uq
  on public.ad_metrics (session_id, platform, campaign_id, date_pulled);

-- 3. Zone read pattern: latest snapshot PER PLATFORM for a session. The page
-- resolves the most recent date_pulled separately for each platform (Meta and
-- Google refresh on independent schedules and can be a day out of step), so
-- platform leads the index.
drop index if exists public.ad_metrics_session_date_idx;

create index if not exists ad_metrics_session_platform_date_idx
  on public.ad_metrics (session_id, platform, date_pulled desc);

-- RLS unchanged: on, no policies, service-role only. Re-granting is harmless
-- and keeps this migration self-contained if applied via the Management API
-- (owner = postgres), where Supabase's automatic service_role grants do NOT
-- fire -- the 42501 that bit us on 0005.
grant all on public.ad_metrics to service_role;
