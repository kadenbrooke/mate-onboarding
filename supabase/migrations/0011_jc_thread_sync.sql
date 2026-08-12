-- 0011_jc_thread_sync.sql
--
-- The J&C First Responder conversation never reached the dashboard thread.
--
-- Two stores held the same conversation and only one of them was wired up:
--
--   jc_sms_conversations.messages  -- JSONB array the n8n First Responder writes,
--                                     one element per turn:
--                                       {"role":"user","text":"..."}       (the lead)
--                                       {"role":"assistant","reply":"..."} (the agent)
--   lead_messages                  -- the row-per-turn table the pipeline page reads
--                                     and LeadThread renders
--
-- 0010's trg_jc_conversation_sync_lead copied the EXTRACTED FIELDS (name, email,
-- address, service, quote) from the first store into client_leads, but never the
-- message array. The visible result: a lead row carrying a $40,500 quote whose
-- conversation panel says "No messages with Steven Mcguffrey yet."
--
-- This migration:
--   1. gives lead_messages a stable dedup key so a turn can be re-synced safely,
--   2. adds sync_jc_conversation_messages() -- the whole mapping, in one place,
--   3. calls it from the existing sync trigger (forward sync),
--   4. calls it once per existing conversation (backfill).
--
-- The DB trigger, not the n8n workflow, owns this on purpose. The trigger already
-- fires on exactly the write that carries a new turn, it cannot be forgotten when
-- somebody edits the workflow, and it needs no change to a live shared production
-- workflow to ship. The field-sync half of the trigger is untouched: its
-- fill-empty-only semantics are intentional.
--
-- Every statement is idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Dedup key
-- ---------------------------------------------------------------------------

-- 'jc:<from_number>:<0-based index in the messages array>'. Stable as long as
-- turns are only appended (they are -- the workflow pushes onto the array), so
-- re-running the sync is a no-op instead of a duplicate thread.
--
-- Nullable, and unique only when set: every existing writer (the reply route,
-- the postcall actions) inserts without a source_key and is unaffected.
alter table public.lead_messages add column if not exists source_key text;

create unique index if not exists lead_messages_source_key_key
  on public.lead_messages (source_key)
  where source_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Conversation array -> thread rows
-- ---------------------------------------------------------------------------

create or replace function public.sync_jc_conversation_messages(
  p_from_number text,
  p_messages    jsonb,
  p_created_at  timestamptz,
  p_updated_at  timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Same hardcoded tenant as sync_jc_conversation_to_lead: jc_sms_conversations
  -- IS the J&C table (no session column). A second client gets its own table and
  -- its own trigger, not a shared one.
  jc_session constant uuid := '61400e73-0570-4167-88d9-d3a69650b15b';
  digits     text;
  v_lead_id  uuid;
  v_n        integer;
  v_first    integer;
  v_start    timestamptz;
  v_end      timestamptz;
  v_base     timestamptz;
  v_floor    timestamptz;
  v_inserted integer := 0;
begin
  if p_from_number is null or p_messages is null or jsonb_typeof(p_messages) <> 'array' then
    return 0;
  end if;

  v_n := jsonb_array_length(p_messages);
  if v_n = 0 then
    return 0;
  end if;

  -- Last 10 digits, so '+13852939577', '3852939577' and '(385) 293-9577' all
  -- resolve to the same lead.
  digits := right(regexp_replace(p_from_number, '[^0-9]', '', 'g'), 10);
  if length(digits) < 10 then
    return 0;
  end if;

  select id into v_lead_id
  from public.client_leads
  where session_id = jc_session
    and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = digits
  limit 1;

  if v_lead_id is null then
    -- No pipeline row for this number: nothing extracted yet, an operator line,
    -- or a wrong number. There is nothing to hang a thread off. Not an error --
    -- the next write to the conversation re-runs this, and because the sync is
    -- whole-array-with-dedup rather than last-turn-only, the ENTIRE history
    -- lands the moment the lead row appears.
    return 0;
  end if;

  -- The JSONB turns carry no per-turn timestamp, so the conversation's own
  -- [created_at, updated_at] window is the best ordering signal available.
  -- Spreading the turns evenly across it keeps the thread in the order it
  -- happened; collapsing them all to now() would not.
  v_start := coalesce(p_created_at, now());
  v_end   := greatest(coalesce(p_updated_at, v_start), v_start);

  -- Highest timestamp already on this lead's thread. Every newly synced turn is
  -- forced above it, so appending turns to an already-synced conversation can
  -- never interleave behind what is already rendered -- including an operator
  -- reply typed in the dashboard between two agent turns.
  select max(created_at) into v_floor
  from public.lead_messages
  where lead_id = v_lead_id;

  -- Index of the first turn not yet synced. On a backfill that is 0 and the
  -- turns spread across the conversation's whole lifetime. On a live append it
  -- is the tail, and those turns spread across [last synced turn, updated_at] --
  -- which IS the window they actually happened in. Without this, a turn that
  -- arrived thirty seconds ago on a three-week-old conversation would be stamped
  -- somewhere in the middle of last week.
  select coalesce(min(t.idx), 0) into v_first
  from (
    select (ord - 1)::int as idx
    from jsonb_array_elements(p_messages) with ordinality as x(value, ord)
  ) t
  where not exists (
    select 1 from public.lead_messages lm
    where lm.source_key = 'jc:' || p_from_number || ':' || t.idx::text
  );

  v_base := case when v_first > 0 then greatest(v_start, coalesce(v_floor, v_start)) else v_start end;
  v_end  := greatest(v_end, v_base);

  with turn as (
    select (ord - 1)::int as idx, t.value as raw
    from jsonb_array_elements(p_messages) with ordinality as t(value, ord)
  ),
  mapped as (
    select
      idx,
      case raw->>'role' when 'user' then 'inbound' else 'outbound' end as direction,
      case raw->>'role' when 'user' then 'lead'    else 'agent'    end as author,
      nullif(btrim(coalesce(raw->>'text', raw->>'reply', '')), '')    as body,
      'jc:' || p_from_number || ':' || idx::text                      as source_key,
      v_base + ((v_end - v_base) * (idx - v_first) / greatest(v_n - 1 - v_first, 1)) as ts
    from turn
    -- Anything that is not a known turn shape is skipped rather than guessed at.
    where raw->>'role' in ('user', 'assistant')
  ),
  ins as (
    insert into public.lead_messages
      (lead_id, session_id, direction, author, channel, body, created_at, source_key)
    select
      v_lead_id, jc_session, m.direction, m.author, 'sms', m.body,
      -- Second term is a strictly-increasing tiebreak, and it is load-bearing in
      -- two cases the interpolation alone gets wrong:
      --   * a conversation whose whole thread arrives on the INSERT has
      --     created_at = updated_at, a zero-width window, so every turn would
      --     otherwise share one timestamp and the thread would render in
      --     arbitrary order;
      --   * turns appended to an already-synced lead must sort after everything
      --     already on it, operator replies included.
      -- Both terms are monotone in idx, so their pointwise max is monotone too:
      -- turn order survives regardless of which term wins.
      greatest(
        m.ts,
        coalesce(v_floor, v_base - interval '1 millisecond') + ((m.idx + 1) * interval '1 millisecond')
      ),
      m.source_key
    from mapped m
    where m.body is not null
    on conflict (source_key) where source_key is not null do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Forward sync -- fold it into the existing trigger
-- ---------------------------------------------------------------------------

-- Identical to 0010's function except for the perform at the end. The
-- fill-empty-only field sync above it is deliberately unchanged.
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

  -- Mirror the conversation into the thread the dashboard reads. Runs after the
  -- branch above, so a lead row created by THIS statement already exists and its
  -- history lands in the same transaction. Re-selects the lead itself rather
  -- than trusting target_id, because the insert above can be swallowed by
  -- trg_client_leads_block_operator (operator numbers are never leads).
  --
  -- Deliberately caught: jc_sms_conversations is the source of truth for a LIVE
  -- SMS agent, lead_messages is only the dashboard's mirror of it. An error in
  -- the mirror must never roll back the turn the First Responder just recorded,
  -- which is what an uncaught exception in an AFTER trigger would do. The
  -- warning lands in the Postgres logs and the next write to this conversation
  -- retries the whole array.
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

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------

-- Same function the trigger calls, so backfilled history and live turns can
-- never diverge. Dedup makes the whole block a no-op on a second run.
do $$
declare
  r     record;
  total integer := 0;
begin
  for r in
    select from_number, messages, created_at, updated_at
    from public.jc_sms_conversations
    order by created_at
  loop
    total := total + public.sync_jc_conversation_messages(
      r.from_number, r.messages, r.created_at, r.updated_at
    );
  end loop;
  raise notice 'jc thread backfill: % lead_messages rows inserted', total;
end $$;
