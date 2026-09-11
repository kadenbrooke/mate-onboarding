-- 0018_client_leads_source_lead_snapshot.sql
--
-- Lead Snapshot (DEL-38) writes client_leads.source = 'lead_snapshot'. The
-- source check constraint predates the feature and rejected the first probe
-- on 2026-09-11 ("violates check constraint client_leads_source_check"),
-- which the intake workflow correctly reported as a failed send and the
-- confirm screen showed as "Could not send. Nothing was texted."
--
-- Re-create the constraint with the new value appended. Every existing value
-- is kept verbatim. Applied live 2026-09-11 via the Management API.

alter table public.client_leads drop constraint if exists client_leads_source_check;
alter table public.client_leads add constraint client_leads_source_check
  CHECK ((source = ANY (ARRAY['meta'::text, 'call'::text, 'text'::text, 'referral'::text, 'google'::text, 'texted_in'::text, 'web_form'::text, 'revived'::text, 'lead_snapshot'::text])));
