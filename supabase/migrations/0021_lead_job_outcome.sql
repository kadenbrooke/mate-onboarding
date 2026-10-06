-- 0021_lead_job_outcome.sql
--
-- Job outcomes per lead, and the return each lead source produced.
--
-- client_leads.status says WHERE a job is (open | booked | quoted | serviced).
-- It never said whether the job was won, what it sold for, or how much cash
-- came in: quote_cents is only the estimate. Without those, nobody can see
-- the return per lead source, and the growth-partner revenue share (15% of
-- cash collected from partner channels) has no basis. Jeffery or Aranza enter
-- outcomes by hand in Mate for now; the Estimate App fills them later.
--
-- This migration adds:
--   1. outcome columns on client_leads (all nullable, CHECKed):
--        job_outcome          'won' | 'lost'
--        outcome_at           when job_outcome was last set (stamped, section 2)
--        job_value_cents      sold price of a won job
--        collected_cents      cash collected to date on a won job, net of
--                             sales tax, refunds and chargebacks
--        collected_at         when collected_cents last changed (stamped)
--        lost_reason          short free text, lost jobs only
--        outcome_recorded_by  auth user id of whoever last entered an outcome,
--                             because these numbers are a billing basis and
--                             someone will ask who typed them
--   2. a BEFORE trigger that stamps outcome_at / collected_at, so no writer
--      can forget them (the trg_client_leads_status_ts pattern, migration 020)
--   3. a BEFORE UPDATE guard that makes client_leads.session_id immutable
--   4. client_lead_revenue_by_source: per tenant, per source, PII-free sums
--      (TypeScript twin: src/lib/metrics/revenue.ts, parity-tested in a real
--      Postgres by src/lib/metrics/revenue.sql.test.ts)
--
-- Deliberately NOT touched:
--   * status. The won/lost pair was retired from status on 2026-08-11 (0010),
--     and two Meta Conversions sweeps still key on status: a dormant one on
--     status in ('won','lost') and source = 'meta_ads', and a live one that
--     fires a Purchase on source = 'meta' and status = 'serviced'. The outcome
--     lives in its own column named job_outcome, so neither sweep (nor any
--     other status consumer) can match it, and nothing here changes when a
--     lead becomes 'serviced'.
--   * source values. Nothing here writes 'meta_ads' or any other source.
--   * jc_sms_conversations, the capi_* columns, and every existing column.
--
-- No row is written. Every statement is idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Outcome columns
-- ---------------------------------------------------------------------------
alter table public.client_leads
  add column if not exists job_outcome         text,
  add column if not exists outcome_at          timestamptz,
  add column if not exists job_value_cents     bigint,
  add column if not exists collected_cents     bigint,
  add column if not exists collected_at        timestamptz,
  add column if not exists lost_reason         text,
  add column if not exists outcome_recorded_by uuid;

alter table public.client_leads drop constraint if exists client_leads_job_outcome_check;
alter table public.client_leads add constraint client_leads_job_outcome_check
  check (job_outcome is null or job_outcome in ('won', 'lost'));

-- An outcome always carries its timestamp and vice versa (section 2 stamps it).
alter table public.client_leads drop constraint if exists client_leads_outcome_at_check;
alter table public.client_leads add constraint client_leads_outcome_at_check
  check ((job_outcome is null) = (outcome_at is null));

-- `is not distinct from`, not `=`: a CHECK passes when its expression is
-- NULL, so `job_outcome = 'won'` would let money onto a lead with no outcome.
alter table public.client_leads drop constraint if exists client_leads_job_value_check;
alter table public.client_leads add constraint client_leads_job_value_check
  check (job_value_cents is null or (job_value_cents >= 0 and job_outcome is not distinct from 'won'));

-- Cash only ever belongs to a won job. A lost job with a deposit that was
-- refunded nets to nothing, which is the agreement's definition anyway.
alter table public.client_leads drop constraint if exists client_leads_collected_check;
alter table public.client_leads add constraint client_leads_collected_check
  check (collected_cents is null or (collected_cents >= 0 and job_outcome is not distinct from 'won'));

alter table public.client_leads drop constraint if exists client_leads_collected_at_check;
alter table public.client_leads add constraint client_leads_collected_at_check
  check ((collected_cents is null) = (collected_at is null));

alter table public.client_leads drop constraint if exists client_leads_lost_reason_check;
alter table public.client_leads add constraint client_leads_lost_reason_check
  check (lost_reason is null or (job_outcome is not distinct from 'lost' and char_length(lost_reason) <= 200));

comment on column public.client_leads.job_outcome is
  'won | lost, entered by the client. NOT status: the Meta CAPI sweeps key on status, never on this.';
comment on column public.client_leads.job_value_cents is
  'Sold price of a won job, whole cents. quote_cents stays the estimate.';
comment on column public.client_leads.collected_cents is
  'Cash collected to date on a won job, whole cents, net of sales tax, refunds and chargebacks.';
comment on column public.client_leads.collected_at is
  'When collected_cents last changed. Stamped by trg_client_leads_outcome_ts.';
comment on column public.client_leads.outcome_at is
  'When job_outcome last changed. Stamped by trg_client_leads_outcome_ts.';

-- ---------------------------------------------------------------------------
-- 2. Timestamps, stamped in the database
-- ---------------------------------------------------------------------------
-- Runs before the CHECKs above, so a writer that sets job_outcome alone still
-- satisfies "outcome carries its timestamp". Clearing the outcome clears it.
create or replace function public.set_client_leads_outcome_ts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.job_outcome is null then
    new.outcome_at := null;
  elsif tg_op = 'INSERT' then
    new.outcome_at := coalesce(new.outcome_at, now());
  elsif new.job_outcome is distinct from old.job_outcome then
    new.outcome_at := now();
  end if;

  if new.collected_cents is null then
    new.collected_at := null;
  elsif tg_op = 'INSERT' then
    new.collected_at := coalesce(new.collected_at, now());
  elsif new.collected_cents is distinct from old.collected_cents then
    new.collected_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_client_leads_outcome_ts on public.client_leads;
create trigger trg_client_leads_outcome_ts
  before insert or update of job_outcome, collected_cents on public.client_leads
  for each row execute function public.set_client_leads_outcome_ts();

-- ---------------------------------------------------------------------------
-- 3. session_id is immutable after insert
-- ---------------------------------------------------------------------------
-- The per-lead API gate (src/lib/portal/lead-gate.ts) authorizes against the
-- lead row's session_id, then the route reads or writes the row again filtered
-- by that same session_id. A session_id that could change between the two
-- would move a lead across tenants under an authorization made for the old
-- one. No writer changes it today (checked 2026-10-06: the mate-onboarding app
-- and SQL triggers, and every client_leads writer in the amos repo's
-- migrations, scripts and n8n exports; the n8n "Ensure Lead SMS" upsert
-- conflicts ON (session_id, phone), so its update keeps session_id equal), so
-- this only turns an unwritten rule into an enforced one.
--
-- The WHEN clause means an UPDATE that re-sets session_id to its own value
-- (that upsert) never reaches the function.
create or replace function public.client_leads_session_id_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'client_leads.session_id is immutable (lead %)', old.id
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_client_leads_session_id_immutable on public.client_leads;
create trigger trg_client_leads_session_id_immutable
  before update of session_id on public.client_leads
  for each row
  when (old.session_id is distinct from new.session_id)
  execute function public.client_leads_session_id_immutable();

-- ---------------------------------------------------------------------------
-- 4. Return per lead source
-- ---------------------------------------------------------------------------
-- One row per (tenant, source): counts and sums only, no lead identity, so the
-- dashboard reads the whole book of business in a handful of rows instead of
-- paging every lead past PostgREST's row cap.
--
--   collected_in_window_cents  cash on leads collected within 24 months of
--                              the lead's first contact (created_at), the
--                              draft agreement's window. The agreement's other
--                              exclusion (anyone on a quote, job or invoice in
--                              the prior 12 months) is NOT computed: Mate has
--                              no record of the client's prior customers.
--   collected_30d_cents        cash whose collected_at is in the last 30 days,
--                              to set against the rolling 30-day Meta spend.
--
-- is_test rows (reseller / founder test phones, migration 032) are excluded,
-- the same rule every dashboard rollup follows.
create or replace view public.client_lead_revenue_by_source
with (security_invoker = true)
as
select
  l.session_id,
  l.source,
  count(*)::int                                                       as leads,
  count(*) filter (where l.job_outcome = 'won')::int                  as won,
  count(*) filter (where l.job_outcome = 'lost')::int                 as lost,
  coalesce(sum(l.job_value_cents) filter (where l.job_outcome = 'won'), 0)::bigint
                                                                      as job_value_cents,
  coalesce(sum(l.collected_cents) filter (where l.job_outcome = 'won'), 0)::bigint
                                                                      as collected_cents,
  coalesce(sum(l.collected_cents) filter (
    where l.job_outcome = 'won'
      and l.collected_at < l.created_at + interval '24 months'
  ), 0)::bigint                                                       as collected_in_window_cents,
  coalesce(sum(l.collected_cents) filter (
    where l.job_outcome = 'won'
      and l.collected_at >= now() - interval '30 days'
  ), 0)::bigint                                                       as collected_30d_cents
from public.client_leads l
where not coalesce(l.is_test, false)
group by l.session_id, l.source;

comment on view public.client_lead_revenue_by_source is
  'Per tenant and lead source: leads, won, lost, job value, cash collected (all, within 24 months of first contact, last 30 days). No PII. Migration 0021.';

-- Same grant shape as client_lead_scores (0020): a Management API migration
-- skips Supabase's automatic grants, and the default privileges would
-- otherwise hand the view to anon / authenticated.
revoke all on public.client_lead_revenue_by_source from anon, authenticated;
grant select on public.client_lead_revenue_by_source to service_role;
