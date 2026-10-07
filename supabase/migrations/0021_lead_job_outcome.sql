-- 0021_lead_job_outcome.sql
--
-- Job outcomes per lead, cash collected per payment, and the return each lead
-- source produced.
--
-- client_leads.status says WHERE a job is (open | booked | quoted | serviced).
-- It never said whether the job was won, what it sold for, or how much cash
-- came in: quote_cents is only the estimate. Without those, nobody can see
-- the return per lead source, and the growth-partner revenue share (15% of
-- cash collected from partner channels within 24 months of first contact) has
-- no basis. Jeffery or Aranza enter outcomes by hand in Mate for now; the
-- Estimate App fills them later.
--
-- Cash is a LEDGER, one row per payment, not a running total on the lead. A
-- running total carries one date, so a $5,000 balance paid months ago plus a
-- $1,000 payment this week would read as $6,000 collected this week, and a
-- job paid across the 24-month line could not be split. Every window below
-- sums only the payments dated inside it. The lead's total is the sum of its
-- payments and is never stored a second time, so the two cannot disagree.
--
-- This migration adds:
--   0. client_leads.is_test, only if it is missing (see section 0)
--   1. outcome columns on client_leads (all nullable, CHECKed):
--        job_outcome          'won' | 'lost'
--        outcome_at           when job_outcome was last set (stamped, section 2)
--        job_value_cents      sold price of a won job
--        lost_reason          short free text, lost jobs only
--        outcome_recorded_by  auth user id of whoever last entered the outcome
--   2. a BEFORE trigger that stamps outcome_at, so no writer can forget it
--      (the trg_client_leads_status_ts pattern, migration 020)
--   3. a BEFORE UPDATE guard that makes client_leads.session_id immutable
--   4. client_lead_payments: the cash ledger, with guards (section 4)
--   5. client_lead_revenue_by_source: per tenant, per source, PII-free sums
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
-- 0. is_test, if missing
-- ---------------------------------------------------------------------------
-- The view in section 5 excludes test rows, like every dashboard rollup. The
-- column comes from the amos repo's migration 032 (a GENERATED column derived
-- from the reseller / founder test phones), which is not in this repo's
-- history. On the live project it already exists, so this statement does
-- nothing there. On a database built from this repo alone it adds a plain
-- false column, so the view (and the app's existing is_test = false filters)
-- work instead of failing; nothing there is a test phone to flag.
alter table public.client_leads
  add column if not exists is_test boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Outcome columns
-- ---------------------------------------------------------------------------
alter table public.client_leads
  add column if not exists job_outcome         text,
  add column if not exists outcome_at          timestamptz,
  add column if not exists job_value_cents     bigint,
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

alter table public.client_leads drop constraint if exists client_leads_lost_reason_check;
alter table public.client_leads add constraint client_leads_lost_reason_check
  check (lost_reason is null or (job_outcome is not distinct from 'lost' and char_length(lost_reason) <= 200));

comment on column public.client_leads.job_outcome is
  'won | lost, entered by the client. NOT status: the Meta CAPI sweeps key on status, never on this.';
comment on column public.client_leads.job_value_cents is
  'Sold price of a won job, whole cents. quote_cents stays the estimate. Cash collected lives in client_lead_payments.';
comment on column public.client_leads.outcome_at is
  'When job_outcome last changed. Stamped by trg_client_leads_outcome_ts.';

-- ---------------------------------------------------------------------------
-- 2. outcome_at, stamped in the database
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
  return new;
end;
$$;

drop trigger if exists trg_client_leads_outcome_ts on public.client_leads;
create trigger trg_client_leads_outcome_ts
  before insert or update of job_outcome on public.client_leads
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
-- this only turns an unwritten rule into an enforced one. It also keeps a
-- lead's payments (section 4, which copy its session_id) in the same tenant.
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
-- 4. The cash ledger
-- ---------------------------------------------------------------------------
-- One row per payment on a won job. amount_cents is net of sales tax. A
-- refund or chargeback is its own row with a negative amount on the day it
-- happened, so cash in any window is the plain sum of the rows in it.
--
-- Rows are insert / delete only: a mistyped payment is removed and entered
-- again, so every row's recorded_by and created_at say who entered that exact
-- amount and when.
create table if not exists public.client_lead_payments (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.client_leads(id) on delete cascade,
  session_id   uuid not null,
  amount_cents bigint not null,
  paid_at      timestamptz not null default now(),
  recorded_by  uuid,
  created_at   timestamptz not null default now(),
  constraint client_lead_payments_amount_check
    check (amount_cents <> 0 and amount_cents between -1000000000 and 1000000000)
);

create index if not exists client_lead_payments_lead_idx
  on public.client_lead_payments (lead_id, paid_at);
create index if not exists client_lead_payments_session_idx
  on public.client_lead_payments (session_id, paid_at);

comment on table public.client_lead_payments is
  'Cash collected per lead, one row per payment (negative = refund or chargeback), net of sales tax. A lead''s total collected is the sum of its rows. Migration 0021.';

-- Insert guard. Locks the lead row first, so a concurrent payment, refund or
-- outcome change on the same lead waits its turn and every check below sees
-- settled numbers.
--   * the lead must exist and be marked won (cash belongs to a won job)
--   * session_id is the lead's, never the writer's (tenant comes from the row)
--   * the lead's running total may not go below zero
create or replace function public.client_lead_payments_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_session uuid;
  v_outcome text;
  v_total   bigint;
begin
  select session_id, job_outcome into v_session, v_outcome
    from public.client_leads where id = new.lead_id for update;
  if not found then
    raise exception 'lead % not found', new.lead_id using errcode = 'foreign_key_violation';
  end if;
  if v_outcome is distinct from 'won' then
    raise exception 'payments can only be recorded on a won job (lead %)', new.lead_id
      using errcode = 'check_violation';
  end if;
  if new.session_id is not null and new.session_id <> v_session then
    raise exception 'payment session does not match lead % session', new.lead_id
      using errcode = 'check_violation';
  end if;
  new.session_id := v_session;

  select coalesce(sum(amount_cents), 0) into v_total
    from public.client_lead_payments where lead_id = new.lead_id;
  if v_total + new.amount_cents < 0 then
    raise exception 'collected total for lead % cannot go below zero', new.lead_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_lead_payments_before_insert on public.client_lead_payments;
create trigger trg_client_lead_payments_before_insert
  before insert on public.client_lead_payments
  for each row execute function public.client_lead_payments_before_insert();

create or replace function public.client_lead_payments_no_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'payments are not edited; delete the payment and enter it again'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_client_lead_payments_no_update on public.client_lead_payments;
create trigger trg_client_lead_payments_no_update
  before update on public.client_lead_payments
  for each row execute function public.client_lead_payments_no_update();

-- Delete guard: removing a payment may not leave the lead's total negative
-- (a refund with nothing left to refund). When the lead itself is being
-- deleted (ON DELETE CASCADE) the lead row is already gone and its payments
-- go with it, so the check is skipped.
create or replace function public.client_lead_payments_before_delete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total bigint;
begin
  perform 1 from public.client_leads where id = old.lead_id for update;
  if not found then
    return old;
  end if;
  select coalesce(sum(amount_cents), 0) into v_total
    from public.client_lead_payments where lead_id = old.lead_id;
  if v_total - old.amount_cents < 0 then
    raise exception 'removing this payment would leave lead % below zero collected; remove the refund first', old.lead_id
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_client_lead_payments_before_delete on public.client_lead_payments;
create trigger trg_client_lead_payments_before_delete
  before delete on public.client_lead_payments
  for each row execute function public.client_lead_payments_before_delete();

-- A won job with payments stays won until its payments are removed, so cash
-- never sits on a lost or blank lead.
create or replace function public.client_leads_outcome_keeps_payments()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.client_lead_payments where lead_id = old.id) then
    raise exception 'lead % has payments recorded; remove them before changing a won job', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_leads_outcome_keeps_payments on public.client_leads;
create trigger trg_client_leads_outcome_keeps_payments
  before update of job_outcome on public.client_leads
  for each row
  when (old.job_outcome = 'won' and new.job_outcome is distinct from 'won')
  execute function public.client_leads_outcome_keeps_payments();

-- Service role only, like client_leads (no policies on purpose). A Management
-- API migration skips Supabase's automatic grants, and the default privileges
-- would otherwise hand the table to anon / authenticated, and UPDATE to
-- service_role. Rows are insert / delete only, so UPDATE is not granted at all
-- (the no-update trigger stays as a backstop for the table owner).
alter table public.client_lead_payments enable row level security;
revoke all on public.client_lead_payments from anon, authenticated, service_role;
grant select, insert, delete on public.client_lead_payments to service_role;

-- ---------------------------------------------------------------------------
-- 5. Return per lead source
-- ---------------------------------------------------------------------------
-- One row per (tenant, source): counts and sums only, no lead identity, so the
-- dashboard reads the whole book of business in a handful of rows instead of
-- paging every lead past PostgREST's row cap.
--
--   collected_cents            every payment, all time
--   collected_in_window_cents  payments dated within 24 months of the lead's
--                              first contact (created_at), the draft
--                              agreement's window. The agreement's other
--                              exclusion (anyone on a quote, job or invoice in
--                              the prior 12 months) is NOT computed: Mate has
--                              no record of the client's prior customers.
--   collected_30d_cents        payments dated in the last 30 days, to set
--                              against the rolling 30-day Meta spend.
--
-- Payments are aggregated per lead first, so a lead counts once in `leads`
-- however many payments it has.
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
  coalesce(sum(p.collected), 0)::bigint                               as collected_cents,
  coalesce(sum(p.in_window), 0)::bigint                               as collected_in_window_cents,
  coalesce(sum(p.last_30d), 0)::bigint                                as collected_30d_cents
from public.client_leads l
left join lateral (
  select
    sum(pay.amount_cents)                                                      as collected,
    sum(pay.amount_cents) filter (where pay.paid_at < l.created_at + interval '24 months')
                                                                               as in_window,
    sum(pay.amount_cents) filter (where pay.paid_at >= now() - interval '30 days')
                                                                               as last_30d
  from public.client_lead_payments pay
  where pay.lead_id = l.id and pay.session_id = l.session_id
) p on true
where not coalesce(l.is_test, false)
group by l.session_id, l.source;

comment on view public.client_lead_revenue_by_source is
  'Per tenant and lead source: leads, won, lost, job value, cash collected from client_lead_payments (all, within 24 months of first contact, last 30 days). No PII. Migration 0021.';

-- Same grant shape as client_lead_scores (0020).
revoke all on public.client_lead_revenue_by_source from anon, authenticated;
grant select on public.client_lead_revenue_by_source to service_role;
