-- 0023_partner_channels_and_gates.sql
--
-- Every current and legacy lead source counts toward the draft partner basis.
-- The one exception is a self_sourced (door knock / cold call) lead that was
-- serviced without the AI texting agent. A self_sourced lead is eligible only
-- when an outbound agent-authored message exists for that lead. This keeps the
-- rule source-driven and prevents a human-only self-sourced deal from entering
-- the basis accidentally.
--
-- The prior-12-month customer caveat remains uncomputed: Mate has no record of
-- the client's prior quotes, jobs, or invoices.

alter table public.client_leads drop constraint if exists client_leads_source_check;
alter table public.client_leads add constraint client_leads_source_check
  check ((source = any (array[
    'meta'::text, 'call'::text, 'text'::text, 'referral'::text,
    'google'::text, 'texted_in'::text, 'web_form'::text, 'revived'::text,
    'lead_snapshot'::text, 'typed'::text, 'self_sourced'::text
  ])));

-- Source is first-touch attribution. In particular, a self_sourced lead must
-- not be relabelled after entry to evade the partner basis, nor relabelled away
-- after entry to become an ordinary partner lead. All existing writers either
-- insert source or leave it untouched on an existing row (including the J&C
-- conversation upserts), so this trigger protects both directions without
-- changing a legitimate enrichment path.
create or replace function public.lock_client_leads_self_sourced()
returns trigger
language plpgsql
as $$
begin
  if old.source is distinct from new.source
     and (old.source = 'self_sourced' or new.source = 'self_sourced') then
    raise exception 'client_leads.source cannot change to or from self_sourced (lead %)', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_leads_self_sourced_lock on public.client_leads;
create trigger trg_client_leads_self_sourced_lock
  before update of source on public.client_leads
  for each row execute function public.lock_client_leads_self_sourced();

-- 0021 created this view with eight columns. The new basis column is appended
-- so CREATE OR REPLACE VIEW remains compatible with PostgreSQL's column rules.
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
  coalesce(sum(p.last_30d), 0)::bigint                                as collected_30d_cents,
  coalesce(sum(p.in_window) filter (
    where l.source <> 'self_sourced'
       or exists (
         select 1
         from public.lead_messages lm
         where lm.lead_id = l.id
           and lm.session_id = l.session_id
           and lm.direction = 'outbound'
           and lm.author = 'agent'
       )
  ), 0)::bigint                                                       as partner_collected_in_window_cents
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
  'Per tenant and lead source: every source counts toward the partner basis except self_sourced leads with no outbound agent message. Cash is within 24 months of first contact; the prior-12-month customer caveat is not computed because Mate has no prior-customer record. No PII. Migration 0023.';

revoke all on public.client_lead_revenue_by_source from anon, authenticated;
grant select on public.client_lead_revenue_by_source to service_role;
