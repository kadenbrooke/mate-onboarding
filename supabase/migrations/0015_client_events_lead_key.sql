-- client_events.lead_key -- the lead a ticker row is about.
--
-- The Ticker rolls repeat activity into one chip per lead and deep-links each
-- chip to that lead's conversation. Until now identity had to be reverse
-- engineered from source_key, which only works for the SMS rows
-- ('jcsms:<phone>:out:<iso>'). A postcall row is keyed by its own uuid, so a
-- lead who both CALLED and TEXTED showed up as two unrelated chips and the
-- call chip could not be clicked at all.
--
-- Key is the normalised phone (last 10 digits), not client_leads.id, for one
-- reason: the lead row is not guaranteed to exist when the event is written.
-- J&C currently has five numbers the First Responder texted that never became
-- client_leads rows. A phone key still groups those correctly and starts
-- resolving the moment the lead row appears; a foreign key would have had to
-- be null and stay null.
--
-- Unlike 0013, backfilling here is safe: this fills a DERIVED column on rows
-- that already exist. It creates no events and cannot splash anything new onto
-- a live dashboard.
--
-- Every statement is idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Column + lookup index
-- ---------------------------------------------------------------------------

alter table public.client_events
  add column if not exists lead_key text;

comment on column public.client_events.lead_key is
  'Normalised lead phone (last 10 digits). Groups ticker rows per lead and '
  'resolves the chip deep link. Null when the row is not about a specific '
  'lead (handoff signals) or no number was recorded.';

create index if not exists client_events_session_lead_key_idx
  on public.client_events (session_id, lead_key, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Normaliser -- mirrors phoneDigits() in src/components/dash/tickerFeed.ts
-- ---------------------------------------------------------------------------

create or replace function public.normalise_lead_phone(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when p_raw is null then null
    when length(regexp_replace(p_raw, '[^0-9]', '', 'g')) >= 10
      then right(regexp_replace(p_raw, '[^0-9]', '', 'g'), 10)
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill existing history
-- ---------------------------------------------------------------------------

-- SMS rows carry the number in source_key: 'jcsms:+16128198700:out:<iso>'.
update public.client_events
set lead_key = public.normalise_lead_phone(split_part(source_key, ':', 2))
where lead_key is null
  and source_key like 'jcsms:%'
  and public.normalise_lead_phone(split_part(source_key, ':', 2)) is not null;

-- postcall rows key off the lead_postcall uuid, which owns a lead_id.
update public.client_events ce
set lead_key = public.normalise_lead_phone(cl.phone)
from public.lead_postcall lp
join public.client_leads cl on cl.id = lp.lead_id
where ce.lead_key is null
  and ce.source_key like 'postcall:%'
  and lp.id::text = split_part(ce.source_key, ':', 2)
  and public.normalise_lead_phone(cl.phone) is not null;

-- ---------------------------------------------------------------------------
-- 4. Teach the SMS trigger to stamp it
-- ---------------------------------------------------------------------------
--
-- Body is 0014's, plus lead_key on the insert. n8n writes jc_sms_conversations
-- directly, so this function is the only place that sees those writes.

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

  -- 'Texted %s' == SMS_OUTBOUND_MESSAGE_TEMPLATE in eventSources.ts.
  -- Keep the literal spelled out here; the parity test greps for it.
  with ins as (
    insert into public.client_events (session_id, agent, kind, message, created_at, source_key, lead_key)
    values (
      jc_session,
      'first_responder',
      'reply',
      format('Texted %s', who),
      p_last_outbound_at,
      'jcsms:' || p_from_number || ':out:' || to_char(p_last_outbound_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      public.normalise_lead_phone(p_from_number)
    )
    on conflict (source_key) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$$;
