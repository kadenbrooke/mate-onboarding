-- Ticker copy: 'Texted %s back' -> 'Texted %s'.
--
-- Founder call: the chip should read "[action] [name]", not "[action] [name]
-- back". The wording has two homes -- SMS_OUTBOUND_MESSAGE_TEMPLATE in
-- src/lib/metrics/eventSources.ts (the app write path) and this trigger
-- function (the n8n write path, which does not go through the app at all) --
-- and eventSources.test.ts fails if they drift.
--
-- 0013 is already applied, so its function is REPLACED here rather than
-- edited in place. Body is identical to 0013's except the format() literal;
-- the comments are reproduced so this file stands on its own.
--
-- Existing client_events rows keep their old wording unless backfilled
-- separately: this only governs rows written from now on.

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

  -- 'Texted %s' == SMS_OUTBOUND_MESSAGE_TEMPLATE in eventSources.ts.
  -- Keep the literal spelled out here; the parity test greps for it.
  with ins as (
    insert into public.client_events (session_id, agent, kind, message, created_at, source_key)
    values (
      jc_session,
      'first_responder',
      'reply',
      format('Texted %s', who),
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
