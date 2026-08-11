-- 0010_pipeline_status.sql
--
-- Turns the Leads table into a PIPELINE table.
--
--  1. client_leads.status: won/lost -> a 4-state pipeline
--       open     -- came in, nothing scheduled yet
--       booked   -- free on-site estimate is scheduled
--       quoted   -- estimate finished, price is out
--       serviced -- job done and paid
--  2. client_leads gains email + address (the First Responder already extracts
--     both into jc_sms_conversations; the pipeline table had nowhere to put them).
--  3. lead_postcall.created_by_fire: did the postcall "fire" action create this
--     lead row, or did the lead already exist? Only a fresh row may be deleted
--     when the operator answers "4 / Ignore".
--  4. jc_sms_conversations -> client_leads sync trigger: text-extracted contact
--     info flows into the pipeline row without touching the live n8n workflow.
--  5. Operator numbers can never become leads.
--
-- Every statement is idempotent enough to re-run.

-- ---------------------------------------------------------------------------
-- 1. Status model
-- ---------------------------------------------------------------------------

alter table public.client_leads drop constraint if exists client_leads_status_check;

-- Real client data (J&C session) is 100% 'open', so nothing there moves. The
-- only non-open rows in the database are the synthetic demo session's, and they
-- have to be remapped or the new constraint cannot be added:
--   won  -> serviced  (money in, the same thing 'won' meant)
--   lost -> quoted    (quoted and never bought is where a lost lead now rests;
--                      there is no terminal "lost" state in this model)
update public.client_leads set status = 'serviced' where status = 'won';
update public.client_leads set status = 'quoted'   where status = 'lost';

-- Demo session only: promote a slice of 'open' rows to 'booked' so the demo
-- dashboard exercises all four states. Deterministic (highest score first), and
-- scoped by session id so it can never touch a real client's pipeline.
update public.client_leads set status = 'booked'
where id in (
  select id from public.client_leads
  where session_id = 'b7573135-d4ec-43bb-bf33-a1d365739784'
    and status = 'open'
  order by score desc nulls last, id
  limit 6
);

alter table public.client_leads
  add constraint client_leads_status_check
  check (status = any (array['open'::text, 'booked'::text, 'quoted'::text, 'serviced'::text]));

-- ---------------------------------------------------------------------------
-- 2. Contact columns
-- ---------------------------------------------------------------------------

alter table public.client_leads add column if not exists email   text;
alter table public.client_leads add column if not exists address text;

-- ---------------------------------------------------------------------------
-- 3. Postcall provenance
-- ---------------------------------------------------------------------------

-- False for every historical row: rows whose provenance is unknown are treated
-- as pre-existing, so "Ignore" can never delete a lead we did not just create.
alter table public.lead_postcall
  add column if not exists created_by_fire boolean not null default false;

-- ---------------------------------------------------------------------------
-- 4. Operator numbers are not leads
-- ---------------------------------------------------------------------------

-- Jeffrey's own operator line ended up in the pipeline: he texted post-call
-- notes when no menu was awaiting, and the SMS path upserted him as a lead.
-- A BEFORE INSERT trigger is the one place that blocks every writer at once
-- (n8n, the app routes, the sync trigger below) without editing any of them.
create or replace function public.block_operator_as_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  op_digits text;
  new_digits text;
begin
  if new.phone is null then
    return new;
  end if;

  -- Compare the last 10 digits so "+18019414398", "8019414398" and
  -- "(801) 941-4398" all resolve to the same number.
  new_digits := right(regexp_replace(new.phone, '[^0-9]', '', 'g'), 10);
  if length(new_digits) < 10 then
    return new;
  end if;

  select right(regexp_replace(coalesce(operator_phone, ''), '[^0-9]', '', 'g'), 10)
    into op_digits
  from public.onboarding_sessions
  where id = new.session_id;

  if op_digits is not null and length(op_digits) = 10 and op_digits = new_digits then
    -- Skip the insert entirely. Callers that expect a returned row will see
    -- "no row" and fail loudly rather than silently owning a bogus lead.
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_client_leads_block_operator on public.client_leads;
create trigger trg_client_leads_block_operator
before insert on public.client_leads
for each row execute function public.block_operator_as_lead();

-- ---------------------------------------------------------------------------
-- 5. jc_sms_conversations -> client_leads sync
-- ---------------------------------------------------------------------------

-- The J&C First Responder (n8n) extracts lead_name / email / property_address /
-- city / service_type / estimated_quote into jc_sms_conversations. Mirroring
-- that into the pipeline row here, in the database, keeps the live workflow
-- untouched. Fill-empty-only: an existing non-null value on client_leads always
-- wins, so nothing a human typed is ever clobbered by a later extraction.
--
-- The session id is hardcoded because jc_sms_conversations IS the J&C table
-- (single-tenant, no session column). If a second client ever gets one of these
-- tables, this becomes a per-table trigger, not a shared one.
create or replace function public.sync_jc_conversation_to_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jc_session constant uuid := '61400e73-0570-4167-88d9-d3a69650b15b';
  digits     text;
  target_id  uuid;
  quote_c    bigint;
begin
  if new.from_number is null then
    return new;
  end if;

  digits := right(regexp_replace(new.from_number, '[^0-9]', '', 'g'), 10);
  if length(digits) < 10 then
    return new;
  end if;

  -- estimated_quote is numeric DOLLARS; client_leads.quote_cents is cents.
  quote_c := case
    when new.estimated_quote is not null and new.estimated_quote > 0
      then round(new.estimated_quote * 100)::bigint
    else null
  end;

  select id into target_id
  from public.client_leads
  where session_id = jc_session
    and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = digits
  limit 1;

  if target_id is null then
    -- A conversation with nothing extracted yet (an inbound "hi", our own
    -- agent number, a wrong number) is not a pipeline row. Wait until it
    -- carries at least one real field.
    if coalesce(new.lead_name, new.email, new.property_address, new.city, new.service_type) is null
       and quote_c is null then
      return new;
    end if;

    insert into public.client_leads
      (session_id, phone, source, handler, name, email, address, city, service, quote_cents)
    values
      (jc_session, new.from_number, 'text', 'agent', new.lead_name, new.email,
       new.property_address, new.city, new.service_type, quote_c)
    on conflict (session_id, phone) do nothing;
    return new;
  end if;

  update public.client_leads set
    name        = coalesce(name,        new.lead_name),
    email       = coalesce(email,       new.email),
    address     = coalesce(address,     new.property_address),
    city        = coalesce(city,        new.city),
    service     = coalesce(service,     new.service_type),
    quote_cents = coalesce(quote_cents, quote_c)
  where id = target_id;

  return new;
end;
$$;

drop trigger if exists trg_jc_conversation_sync_lead on public.jc_sms_conversations;
create trigger trg_jc_conversation_sync_lead
after insert or update on public.jc_sms_conversations
for each row execute function public.sync_jc_conversation_to_lead();
