-- 0024_partner_attribution_rule.sql
--
-- Partner attribution and refund rule, extending 0023 without changing any
-- applied migration. Every lead source is partner-owned; a self_sourced lead
-- is partner-eligible only when an identified counting agent worked it. The
-- durable message signal is lead_messages.source, not author='agent' alone:
-- fr, cultivator, and reactivator count; operator/reputation/null do not.
--
-- partner_refund_clawback_window_months = 0 is the founder's opening position:
-- refunds never lower the partner share. A negotiated positive value would
-- credit a refund only when it follows a payment within that many calendar
-- months. The TypeScript setting has the same value and is parity-tested.
--
-- This migration is intentionally UNAPPLIED in the founder-gated workflow.

-- The live J&C instrumentation already has this column. Adding it here keeps a
-- database built from Mate's own history able to run the same view. This does
-- not touch jc_sms_conversations or any lead-handling table.
alter table public.lead_messages add column if not exists source text;

create or replace view public.client_lead_revenue_by_source
with (security_invoker = true)
as
with agreement as (
  select 0::integer as partner_refund_clawback_window_months
)
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
  coalesce(sum(p.partner_basis) filter (
    where l.source <> 'self_sourced'
       or exists (
         select 1
         from public.lead_messages lm
         where lm.lead_id = l.id
           and lm.session_id = l.session_id
           and lm.direction = 'outbound'
           and lm.author = 'agent'
           and lm.source in ('fr', 'cultivator', 'reactivator')
       )
  ), 0)::bigint                                                       as partner_collected_in_window_cents
from public.client_leads l
cross join agreement
left join lateral (
  select
    sum(pay.amount_cents) as collected,
    -- There is no lead-age cutoff. Keep the old column for app/API parity.
    sum(pay.amount_cents) as in_window,
    sum(pay.amount_cents) filter (where pay.paid_at >= now() - interval '30 days')
                                                                      as last_30d,
    greatest(coalesce(sum(case
      when pay.amount_cents > 0 then pay.amount_cents
      when pay.amount_cents < 0
       and agreement.partner_refund_clawback_window_months > 0
       and exists (
         select 1
         from public.client_lead_payments original
         where original.lead_id = pay.lead_id
           and original.session_id = pay.session_id
           and original.amount_cents > 0
           and original.paid_at <= pay.paid_at
           and pay.paid_at < original.paid_at
             + agreement.partner_refund_clawback_window_months * interval '1 month'
       ) then pay.amount_cents
      else 0
    end), 0), 0) as partner_basis
  from public.client_lead_payments pay
  where pay.lead_id = l.id and pay.session_id = l.session_id
) p on true
where not coalesce(l.is_test, false)
group by l.session_id, l.source;

comment on view public.client_lead_revenue_by_source is
  'Per tenant and lead source: every source counts toward the partner basis except self_sourced leads without a tagged counting-agent message (fr, cultivator, or reactivator). Cash has no lead-age cutoff; refund clawback is controlled by the single partner_refund_clawback_window_months setting, currently 0/off. No PII. Migration 0024.';

revoke all on public.client_lead_revenue_by_source from anon, authenticated;
grant select on public.client_lead_revenue_by_source to service_role;
