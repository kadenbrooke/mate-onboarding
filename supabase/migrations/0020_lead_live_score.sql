-- 0020_lead_live_score.sql
--
-- Every lead gets a LIVE score, and the dashboard ranks by it.
--
-- client_leads.score was only ever written for the seeded demo session. The
-- real scorer, the July "JC Lead Ranker" n8n workflow (8J6yuD5zxQIDDd0w),
-- writes its numbers to the client's Google Sheet and never to Supabase, so
-- the Hot Leads card had nothing to rank for a real client.
--
-- Founder-approved formula (2026-10-06): the Ranker's, reweighted to 80%, plus
-- reply recency at 20%:
--
--   score = round(100 x (0.24 value + 0.20 urgency + 0.16 proximity
--                        + 0.12 freshness + 0.08 completeness + 0.20 reply))
--
-- Freshness and reply decay with the clock, so a stored score goes stale the
-- moment it is written and a trigger cannot keep it right. The score is
-- therefore computed when it is READ: client_lead_scores is a plain view that
-- evaluates mate_lead_score(..., now()) per lead on every query. Nothing is
-- stored, nothing is scheduled, nothing can fall behind.
--
-- This migration creates:
--   1. mate_city_tier(city), mate_lead_tier(city, address, phone)
--                             -- city -> tier (First Responder lists + the tiers
--                                the client set by hand in the lead sheet),
--                                area-code tier for a lead with no location
--   2. mate_lead_score(...)   -- the formula, in ONE place. TypeScript twin:
--                                src/lib/metrics/leadScore.ts, parity-tested
--                                against this file in a real Postgres
--                                (src/lib/metrics/leadScore.sql.test.ts).
--   3. one index for the view's reply-recency lookup
--   4. client_lead_scores     -- lead_id -> live score, plus the inputs used.
--
-- Read-only with respect to existing data: no column or constraint changes,
-- no row is written, no trigger is added (one lead_messages index, section 3).
-- jc_sms_conversations is not changed at all, not even indexed: it is only
-- read, through the same link the sync trigger uses (J&C session + last 10
-- phone digits).
--
-- Arithmetic is float8 in the same order as the TypeScript twin, and rounding
-- is floor(x + 0.5) (JavaScript's Math.round), so the twins agree exactly.
-- Every statement is idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Tier
-- ---------------------------------------------------------------------------
-- Tier 1 / 2 cities are ported verbatim from the First Responder's "Build Lead
-- Summary" node (n8n workflow MyTAmqQsLDUtAyep, export 2026-09-30): lowercased,
-- trimmed, exact match. Tier 1 = Utah County (around Orem), Tier 2 = Salt Lake
-- Valley.
--
-- Tiers 3 to 5 were set by hand in the 'Active Leads' tab of the client's lead
-- sheet (the one the Ranker reads). The lists below are the distinct
-- city -> tier pairs recovered from that tab's City and Tier columns on
-- 2026-10-06; every Tier 1 / 2 city in the sheet is already in the FR lists.
-- 3 = Summit County, 4 = Davis / Weber, 5 = Box Elder / Cache.
--
-- Returned as text because the sheet's tiers include '8b'.
create or replace function public.mate_city_tier(p_city text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when lower(btrim(coalesce(p_city, ''), E' \t\r\n\f\v')) = any (array[
      'orem','provo','pleasant grove','lindon','american fork','lehi','springville',
      'spanish fork','payson','vineyard','saratoga springs','eagle mountain','highland',
      'alpine','cedar hills','mapleton','salem','santaquin','genola','elk ridge',
      'woodland hills'
    ]) then '1'
    when lower(btrim(coalesce(p_city, ''), E' \t\r\n\f\v')) = any (array[
      'salt lake city','west jordan','south jordan','sandy','draper','riverton','bluffdale',
      'herriman','west valley city','west valley','murray','midvale','taylorsville','holladay',
      'cottonwood heights','millcreek','magna','kearns','south salt lake'
    ]) then '2'
    when lower(btrim(coalesce(p_city, ''), E' \t\r\n\f\v')) = any (array[
      'park city'
    ]) then '3'
    when lower(btrim(coalesce(p_city, ''), E' \t\r\n\f\v')) = any (array[
      'clearfield','clinton','coalville','ogden','roy','south weber'
    ]) then '4'
    when lower(btrim(coalesce(p_city, ''), E' \t\r\n\f\v')) = any (array[
      'beaverdam','corinne','logan','thatcher','tremonton'
    ]) then '5'
    else null
  end;
$$;

-- The lead's tier. By city when it gave one. With neither a city nor an
-- address, the sheet tiered by phone area code: '7' Wasatch Front (801, 385),
-- '8' the 435 area code, '8b' out of state. In the sheet those three appear
-- only on rows with no city.
create or replace function public.mate_lead_tier(p_city text, p_address text, p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when btrim(coalesce(p_city, ''), E' \t\r\n\f\v') <> '' then public.mate_city_tier(p_city)
    when btrim(coalesce(p_address, ''), E' \t\r\n\f\v') <> '' then null
    when length(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10)) < 10 then null
    when left(right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10), 3) in ('801', '385') then '7'
    when left(right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10), 3) = '435' then '8'
    else '8b'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The formula
-- ---------------------------------------------------------------------------
-- Pure: the clock comes in as p_now, so the function is immutable and the
-- same inputs always give the same score. The view passes now().
create or replace function public.mate_lead_score(
  p_quote_cents        bigint,
  p_timeframe          text,
  p_city               text,
  p_name               text,
  p_phone              text,
  p_address            text,
  p_dimensions         text,
  p_created_at         timestamptz,
  p_last_lead_reply_at timestamptz,
  p_now                timestamptz
)
returns integer
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  ws           constant text := E' \t\r\n\f\v';
  tf           text := lower(coalesce(p_timeframe, ''));
  tier         text := public.mate_lead_tier(p_city, p_address, p_phone);
  v_value      float8;
  v_urgency    float8;
  v_proximity  float8;
  v_freshness  float8;
  v_complete   float8;
  v_reply      float8;
  age_days     float8;
  reply_days   float8;
  raw          float8;
begin
  -- value: no quote (or a non-positive one) is a neutral 0.3; $25,000+ caps at 1.
  v_value := case
    when p_quote_cents is null or p_quote_cents <= 0 then 0.3::float8
    else least((p_quote_cents::float8 / 100::float8) / 25000::float8, 1::float8)
  end;

  -- urgency: the Ranker's regexes in the Ranker's order (far-off is checked
  -- before two weeks, so "more than 2 weeks" is 0.3).
  v_urgency := case
    when tf ~ 'asap|today|tomorrow|this week|right away|right now' then 1.0::float8
    when tf ~ 'more than|over a|later|someday|next year|spring|fall' then 0.3::float8
    when tf ~ 'next week|1 week|a week|in the next week' then 0.9::float8
    when tf ~ '2 week|two week|couple week' then 0.85::float8
    when tf ~ '30 day|month|3 week|few week' then 0.6::float8
    else 0.4::float8
  end;

  -- proximity: the Ranker matched tier labels by prefix, so 8b scores like 8.
  -- Tiers 4, 5 and 7 carry no weight of their own.
  v_proximity := case
    when tier = '1' then 1.0::float8
    when tier = '2' then 0.7::float8
    when tier = '3' then 0.5::float8
    when tier in ('8', '8b') then 0.1::float8
    when btrim(coalesce(p_city, ''), ws) <> '' then 0.4::float8
    else 0.3::float8
  end;

  -- freshness by lead age, in days.
  age_days := extract(epoch from (p_now - p_created_at))::float8 / 86400::float8;
  v_freshness := case
    when age_days <= 2 then 1.0::float8
    when age_days <= 7 then 0.7::float8
    when age_days <= 14 then 0.4::float8
    else 0.2::float8
  end;

  -- completeness: filled count of the six fields the Ranker checked.
  v_complete := (
      (btrim(coalesce(p_name, ''),       ws) <> '')::int
    + (btrim(coalesce(p_phone, ''),      ws) <> '')::int
    + (btrim(coalesce(p_address, ''),    ws) <> '')::int
    + (btrim(coalesce(p_city, ''),       ws) <> '')::int
    + (btrim(coalesce(p_timeframe, ''),  ws) <> '')::int
    + (btrim(coalesce(p_dimensions, ''), ws) <> '')::int
  )::float8 / 6::float8;

  -- reply: how recently the LEAD last texted. Never replied = 0.
  if p_last_lead_reply_at is null then
    v_reply := 0::float8;
  else
    reply_days := extract(epoch from (p_now - p_last_lead_reply_at))::float8 / 86400::float8;
    v_reply := case
      when reply_days <= 1 then 1.0::float8
      when reply_days <= 3 then 0.8::float8
      when reply_days <= 7 then 0.6::float8
      when reply_days <= 14 then 0.4::float8
      else 0.2::float8
    end;
  end if;

  raw := 100::float8 * (
      0.24::float8 * v_value + 0.20::float8 * v_urgency + 0.16::float8 * v_proximity
    + 0.12::float8 * v_freshness + 0.08::float8 * v_complete + 0.20::float8 * v_reply
  );
  return greatest(0, least(100, floor(raw + 0.5::float8)::integer));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Index for reply recency
-- ---------------------------------------------------------------------------
-- An index only: no column, constraint, trigger or row change on lead_messages.
-- The table is small today, so the brief lock a plain CREATE INDEX takes is
-- negligible.
create index if not exists lead_messages_lead_reply_idx
  on public.lead_messages (lead_id, created_at desc)
  where direction = 'inbound' and author = 'lead';

-- The conversation link is NOT indexed here on purpose. jc_sms_conversations
-- belongs to the lead-handling lane (First Responder, fr-brain) and this
-- migration makes no change to it. At about 60 rows the join does not need
-- one. If it ever does, that lane can add an expression index on
-- right(regexp_replace(from_number, '[^0-9]', '', 'g'), 10), the exact
-- expression the view compares.

-- ---------------------------------------------------------------------------
-- 4. The live view
-- ---------------------------------------------------------------------------
-- One row per client_leads row. Inputs come from client_leads first, else from
-- the mirrored First Responder conversation:
--   quote       client_leads.quote_cents, else estimated_quote (dollars, > 0)
--   timeframe   jc_sms_conversations.timeline        (client_leads has none)
--   dimensions  jc_sms_conversations.estimated_dimensions (client_leads has none)
--   name / address / city   client_leads, else the conversation's
--   reply       max(lead_messages.created_at), inbound from the lead
-- The conversation link is the sync trigger's (0010/0011/0013): the J&C
-- session and the last 10 digits of the phone. Any other session, and a
-- Meta-only lead with no conversation, simply scores on what it has.
--
-- security_invoker: the view reads with the caller's rights, so it can never
-- expose more than the underlying tables would. The app reads it with the
-- service-role client, like every other client_* table.
create or replace view public.client_lead_scores
with (security_invoker = true)
as
select
  cl.id         as lead_id,
  cl.session_id,
  public.mate_lead_score(
    coalesce(
      cl.quote_cents,
      case when jc.estimated_quote > 0 then round(jc.estimated_quote * 100)::bigint end
    ),
    jc.timeline,
    coalesce(cl.city, jc.city),
    coalesce(cl.name, jc.lead_name),
    cl.phone,
    coalesce(cl.address, jc.property_address),
    jc.estimated_dimensions,
    cl.created_at,
    lr.last_lead_reply_at,
    now()
  )             as score,
  public.mate_lead_tier(coalesce(cl.city, jc.city), coalesce(cl.address, jc.property_address), cl.phone) as tier,
  jc.timeline   as timeframe,
  lr.last_lead_reply_at
from public.client_leads cl
left join lateral (
  select max(lm.created_at) as last_lead_reply_at
  from public.lead_messages lm
  where lm.lead_id = cl.id
    and lm.direction = 'inbound'
    and lm.author = 'lead'
) lr on true
left join lateral (
  select c.timeline, c.estimated_dimensions, c.estimated_quote,
         c.city, c.lead_name, c.property_address
  from public.jc_sms_conversations c
  -- Same hardcoded tenant as sync_jc_conversation_to_lead: jc_sms_conversations
  -- IS the J&C table (no session column).
  where cl.session_id = '61400e73-0570-4167-88d9-d3a69650b15b'::uuid
    and length(right(regexp_replace(coalesce(cl.phone, ''), '[^0-9]', '', 'g'), 10)) = 10
    and right(regexp_replace(c.from_number, '[^0-9]', '', 'g'), 10)
      = right(regexp_replace(cl.phone, '[^0-9]', '', 'g'), 10)
  order by c.updated_at desc nulls last
  limit 1
) jc on true;

comment on view public.client_lead_scores is
  'Live lead score (mate_lead_score), computed at read time so freshness and reply recency never go stale. Migration 0020.';

-- A Management API migration skips Supabase's automatic grants, and the
-- default privileges would otherwise hand the view to anon/authenticated.
revoke all on public.client_lead_scores from anon, authenticated;
grant select on public.client_lead_scores to service_role;
