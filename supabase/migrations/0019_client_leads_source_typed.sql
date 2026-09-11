-- 0019_client_leads_source_typed.sql
--
-- Manual lead entry (manual-lead-entry-spec.md in the amos repo) writes
-- client_leads.source = 'typed' for a lead the client keyed in by hand.
-- Same shape as 0018: re-create the source check with the value appended,
-- every existing value kept verbatim.

alter table public.client_leads drop constraint if exists client_leads_source_check;
alter table public.client_leads add constraint client_leads_source_check
  CHECK ((source = ANY (ARRAY['meta'::text, 'call'::text, 'text'::text, 'referral'::text, 'google'::text, 'texted_in'::text, 'web_form'::text, 'revived'::text, 'lead_snapshot'::text, 'typed'::text])));
