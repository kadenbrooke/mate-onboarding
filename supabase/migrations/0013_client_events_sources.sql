-- 0013_client_events_sources.sql
--
-- client_events was a demo-only table.
--
-- Every row in it belonged to the seeded demo session (b7573135), written by
-- scripts/seed-demo-leads.mjs. Nothing in production ever wrote it, and the
-- only production references were the dashboard READING it. So five displays
-- were permanently dead for every paying client while the demo looked alive:
-- the Ticker, Hours Saved, Calls Handled, Agent Activity, and the hero
-- actions/hours sparklines.
--
-- Real agent work does exist, in tables the dashboard never read. This
-- migration makes client_events writable from those tables:
--
--   1. source_key + a unique index, so one real-world action can only ever
--      produce one ticker line no matter how many times a webhook retries or
--      a trigger re-fires.
--   2. an index for the missed-call denominator count query.
--   3. emit_jc_sms_client_event() -- jc_sms_conversations is written by an
--      external n8n workflow, so there is no app-side hook. The database is
--      the only place that sees every write, exactly as with the lead_messages
--      mirror in 0011.
--   4. that function folded into the existing sync trigger.
--
-- The app-side paths (/api/agent/postcall, /api/agent/signal) emit through
-- src/lib/metrics/eventSources.ts. The wording below is deliberately the SAME
-- template that module exports (SMS_OUTBOUND_MESSAGE_TEMPLATE); a vitest test
-- reads this file and fails if the two drift.
--
-- NO BACKFILL HERE ON PURPOSE. Existing history is backfilled by
-- scripts/backfill-client-events.ts, run deliberately by the founder, so
-- applying this migration cannot splash thirty rows onto a live dashboard as
-- a side effect.
--
-- Every statement is idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Dedupe key
-- ---------------------------------------------------------------------------

alter table public.client_events add column if not exists source_key text;

-- NOT a partial index, unlike lead_messages_source_key_key in 0011. NULLs are
-- distinct in a unique index, so the 25 existing demo rows (and any future
-- writer that does not set a key) are unaffected, AND PostgREST can infer this
-- index from `on_conflict=source_key`, which it cannot do for a partial one.
create unique index if not exists client_events_source_key_uq
  on public.client_events (source_key);

-- ---------------------------------------------------------------------------
-- 2. Denominator query support
-- ---------------------------------------------------------------------------

-- The dashboard counts missed-call events per session with a head/count query
-- (it needs the number, not the rows). Without this the count is a seq scan
-- on every dashboard load.
create index if not exists client_events_session_kind_idx
  on public.client_events (session_id, kind);

-- Applying a migration through the Management API runs as `postgres`, which
-- SKIPS the default privilege grants Supabase auto-applies to new objects. The
-- table predates this file so the grant is almost certainly already in place;
-- it is restated because 0005 learned the hard way that assuming it 403s at
-- runtime. `grant` is idempotent.
grant all on public.client_events to service_role;

-- ---------------------------------------------------------------------------
-- 3. jc_sms_conversations -> client_events
-- ---------------------------------------------------------------------------

-- What can honestly be derived from this table, and what cannot:
--
--   messages          -- a JSONB array of {role, text} with NO per-message
--                        timestamps. Per-message events are therefore
--                        impossible to date and are NOT emitted. (0011 spreads
--                        them across the conversation window for THREAD ORDER,
--                        which is a display ordering; using those interpolated
--                        instants as "when the agent did work" would be
--                        manufacturing activity, not reporting it.)
--   last_inbound_at   -- the lead texting in. Real, but not agent work, and
--                        Hours Saved multiplies event count by minutes, so
--                        counting it would overstate the client's savings.
--   last_outbound_at  -- the agent sending a text. Populated on every row.
--                        THIS is the one honest signal, and it is what the
--                        function below emits: one event per distinct value.
--
-- Two texts sent between two writes of the row collapse into one event. That
-- undercounts. Undercounting is the correct failure mode here.
create or replace function public.emit_jc_sms_client_event(
  p_from_number      text,
  p_lead_name        text,
  p_last_outbound_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Same hardcoded tenant as sync_jc_conversation_to_lead: jc_sms_conversations
  -- IS the J&C table (single-tenant, no session column).
  jc_session constant uuid := '61400e73-0570-4167-88d9-d3a69650b15b';
  digits   text;
  who      text;
  v_count  integer := 0;
begin
  if p_from_number is null or p_last_outbound_at is null then
    return 0;
  end if;

  -- Mirrors formatPhone() in src/lib/metrics/eventSources.ts: a 10-digit US
  -- number (with or without a leading 1) renders as "(801) 891-5463";
  -- anything else is left exactly as it arrived rather than half-formatted.
  digits := regexp_replace(p_from_number, '[^0-9]', '', 'g');
  if length(digits) = 11 and left(digits, 1) = '1' then
    digits := right(digits, 10);
  end if;

  who := coalesce(
    nullif(btrim(coalesce(p_lead_name, '')), ''),
    case when length(digits) = 10
      then '(' || substr(digits, 1, 3) || ') ' || substr(digits, 4, 3) || '-' || substr(digits, 7, 4)
      else btrim(p_from_number)
    end
  );

  -- 'Texted %s back' == SMS_OUTBOUND_MESSAGE_TEMPLATE in eventSources.ts.
  -- Keep the literal spelled out here; the parity test greps for it.
  with ins as (
    insert into public.client_events (session_id, agent, kind, message, created_at, source_key)
    values (
      jc_session,
      'first_responder',
      'reply',
      format('Texted %s back', who),
      p_last_outbound_at,
      'jcsms:' || p_from_number || ':out:' || to_char(p_last_outbound_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    on conflict (source_key) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fold it into the existing sync trigger
-- ---------------------------------------------------------------------------

-- Identical to 0011's function except for the second perform block. Both the
-- field sync and the thread mirror above it are deliberately unchanged.
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

  -- Activity feed FIRST, before any of the pipeline branching below.
  --
  -- Load-bearing placement: every branch after this point can return early
  -- (a short number, or a conversation with nothing extracted yet and no
  -- matching lead row), and most J&C conversations are exactly that second
  -- case. An outbound text is a real thing the agent did whether or not the
  -- conversation ever became a pipeline row, so it must not be gated on one.
  --
  -- Deliberately swallowed: jc_sms_conversations is the source of truth for a
  -- LIVE SMS agent and client_events is only the dashboard's mirror of it. An
  -- uncaught exception in an AFTER trigger would roll back the turn the First
  -- Responder just recorded. A broken mirror must never cost a real turn.
  begin
    perform public.emit_jc_sms_client_event(
      new.from_number, new.lead_name, new.last_outbound_at
    );
  exception when others then
    raise warning 'emit_jc_sms_client_event failed for % : % (%)',
      new.from_number, sqlerrm, sqlstate;
  end;

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
  else
    update public.client_leads set
      name        = coalesce(name,        new.lead_name),
      email       = coalesce(email,       new.email),
      address     = coalesce(address,     new.property_address),
      city        = coalesce(city,        new.city),
      service     = coalesce(service,     new.service_type),
      quote_cents = coalesce(quote_cents, quote_c)
    where id = target_id;
  end if;

  -- Mirror the conversation into the thread the dashboard reads (0011).
  --
  -- Deliberately caught: jc_sms_conversations is the source of truth for a LIVE
  -- SMS agent, lead_messages is only the dashboard's mirror of it. An error in
  -- the mirror must never roll back the turn the First Responder just recorded,
  -- which is what an uncaught exception in an AFTER trigger would do.
  begin
    perform public.sync_jc_conversation_messages(
      new.from_number, new.messages, new.created_at, new.updated_at
    );
  exception when others then
    raise warning 'sync_jc_conversation_messages failed for % : % (%)',
      new.from_number, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

drop trigger if exists trg_jc_conversation_sync_lead on public.jc_sms_conversations;
create trigger trg_jc_conversation_sync_lead
after insert or update on public.jc_sms_conversations
for each row execute function public.sync_jc_conversation_to_lead();
