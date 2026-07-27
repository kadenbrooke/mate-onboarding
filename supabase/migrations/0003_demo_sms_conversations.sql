-- Instant First Responder Demo — demo_sms_conversations + atomic demo_counters
--
-- CRITICAL FIX C1: demo-voice/index.ts and demo-sms/index.ts read/upsert
-- public.demo_sms_conversations keyed (from_number, business), but no SQL migration
-- ever created it (the 3TR deploy created it ad hoc). This migration brings the
-- table under version control so a fresh DB reproduces prod, and asserts the
-- composite (from_number, business) PK the FR-demo ON CONFLICT upsert target needs.
-- Live prod already has that composite PK, so every DDL statement here is a no-op
-- against prod; the value is a truthful, replayable definition of the live shape.
--
-- CRITICAL FIX C2 / HIGH FIX H1 / HIGH FIX H4: the app-side guard is a
-- check-then-insert (TOCTOU) and the inbound qualify loop had no cap at all. The
-- authoritative limits now live in the DB as atomic counters: the increment IS the
-- gate. demo_counters holds per-day counters keyed by (day, scope, key); the
-- demo_counter_bump() RPC increments-under-cap in a single statement so N
-- concurrent requests can never overshoot.
--
-- Management-API-created tables get NO DML grants by default, so this migration
-- ends with explicit grants to service_role (the only role that touches these
-- tables — all access is via trusted server routes / edge functions, never the
-- browser).

-- ---------------------------------------------------------------------------
-- C1: multi-turn SMS conversation state.
--
-- HISTORY (verified against git + live prod, ref jeqnvdlfybpmbovywknz, 2026-07-27):
-- This table is SHARED with the 3TR demo SMS agent (business='3tr'). No SQL
-- migration ever created it — the 3TR deploy created it ad hoc, ALREADY with the
-- composite PK (from_number, business) and a column default of '3tr' on business.
-- As of this migration the table is EMPTY (0 rows); there are no pre-existing rows
-- to preserve. So this file is written to be REPLAY-EQUIVALENT to prod: on a fresh
-- DB the create table below produces exactly the live shape (composite PK, business
-- default '3tr'); on prod every statement here is a verified no-op.
--
-- Neither demo path relies on the column default: the FR edge functions always pass
-- business='fr_demo' explicitly (see _shared/db.ts upsertConversation + index.ts
-- BUSINESS const) and the 3TR function always passes business='3tr' explicitly. The
-- default only governs a hypothetical insert that omits the column, which no caller
-- does. It is therefore left as prod has it ('3tr') rather than silently flipped.
-- ---------------------------------------------------------------------------
create table if not exists public.demo_sms_conversations (
  from_number  text not null,
  -- Default '3tr' to match live prod exactly (fresh-DB replay == prod). Callers
  -- always pass business explicitly, so this default is never actually exercised.
  business     text not null default '3tr',
  -- Bounded turn history: [{ role, content }, ...]. Appended per inbound reply.
  messages     jsonb not null default '[]'::jsonb,
  -- C2(a): per-sender assistant-reply counter. The inbound qualify loop bumps this
  -- and stops replying once it crosses the per-sender daily cap, so one number can
  -- not run our model + outbound-SMS spend unbounded.
  reply_count  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (from_number, business)
);

-- Idempotent column backfill. On a fresh DB every column already exists from the
-- create table above (all no-ops); on prod they already exist too. Defaults here
-- mirror the create table above so a column that somehow WAS missing lands in the
-- same shape as prod. business is intentionally omitted: it exists in prod with
-- default '3tr' and re-adding it with a different default would be a lie (the
-- add-column would no-op and NOT change the existing default anyway).
alter table public.demo_sms_conversations
  add column if not exists reply_count  integer not null default 0,
  add column if not exists created_at   timestamptz not null default now(),
  add column if not exists updated_at   timestamptz not null default now();

-- Assert the composite (from_number, business) PK. Idempotent: only acts when the
-- current PK is not exactly (from_number, business). Live prod ALREADY has this
-- composite PK (verified 2026-07-27), so this block is a no-op against prod; it
-- exists so a fresh-DB replay from an older shape converges to the live prod shape.
do $$
declare
  v_pk_cols text;
begin
  select string_agg(a.attname, ',' order by array_position(con.conkey, a.attnum))
    into v_pk_cols
  from pg_constraint con
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
  where con.conrelid = 'public.demo_sms_conversations'::regclass
    and con.contype = 'p';

  if v_pk_cols is distinct from 'from_number,business' then
    if v_pk_cols is not null then
      execute 'alter table public.demo_sms_conversations drop constraint '
        || (select conname from pg_constraint
            where conrelid = 'public.demo_sms_conversations'::regclass and contype = 'p');
    end if;
    alter table public.demo_sms_conversations
      add primary key (from_number, business);
  end if;
end
$$;

-- TTL sweep housekeeping (see the cron block below).
create index if not exists demo_sms_conversations_updated_idx
  on public.demo_sms_conversations (updated_at);

grant select, insert, update, delete on public.demo_sms_conversations to service_role;

-- ---------------------------------------------------------------------------
-- C2 / H1 / H4: atomic per-day counters. The increment IS the gate.
-- ---------------------------------------------------------------------------
-- scope examples:
--   'demo_start_global'  key '-'            -> H1 global daily breaker (start route)
--   'demo_start_phone'   key '<e164>'       -> H1 per-phone daily cap (start route)
--   'sms_reply_global'   key '-'            -> C2(b) global outbound-SMS breaker
--   'code_attempt'       key '<e164>'       -> H4 inbound 6-digit code-attempt throttle
create table if not exists public.demo_counters (
  day    date not null default (now() at time zone 'utc')::date,
  scope  text not null,
  key    text not null,
  n      integer not null default 0,
  primary key (day, scope, key)
);

create index if not exists demo_counters_day_idx on public.demo_counters (day);

grant select, insert, update, delete on public.demo_counters to service_role;

-- Atomic increment-under-cap. Returns true when the bump was applied (caller is
-- ALLOWED to proceed), false when already at/over the cap (caller is BLOCKED).
-- Implemented as a single INSERT ... ON CONFLICT DO UPDATE with a WHERE guard on
-- the existing count; the UPDATE only fires while n < p_cap, so concurrent callers
-- serialize on the row and the (p_cap+1)-th caller gets no updated row back.
create or replace function public.demo_counter_bump(
  p_scope text,
  p_key   text,
  p_cap   integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_n     integer;
begin
  insert into public.demo_counters as c (day, scope, key, n)
    values (v_today, p_scope, p_key, 1)
  on conflict (day, scope, key) do update
    set n = c.n + 1
    where c.n < p_cap
  returning n into v_n;

  -- v_n is NULL when the ON CONFLICT UPDATE's WHERE was false (already at cap) and
  -- no fresh insert happened. A returned count means we were allowed to increment.
  return v_n is not null;
end;
$$;

grant execute on function public.demo_counter_bump(text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- H3(a): extend the PII TTL sweep to demo_sms_conversations (inbound texts) and
-- prune stale counters. The 0002 cron only swept demo_sessions; inbound SMS bodies
-- in demo_sms_conversations never expired. Re-schedule the same-named job with the
-- broader body (cron.schedule upserts by name).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'demo_sessions_ttl',
      '*/15 * * * *',
      $ttl$
        update public.demo_sessions
          set status = 'expired'
          where status in ('building','ready') and expires_at < now();
        delete from public.demo_sessions
          where created_at < now() - interval '7 days';
        -- H3(a): inbound texts are PII; hard-delete conversation threads after 7 days.
        delete from public.demo_sms_conversations
          where updated_at < now() - interval '7 days';
        -- Counters are not PII but grow unbounded; keep a short window.
        delete from public.demo_counters
          where day < (now() at time zone 'utc')::date - interval '7 days';
      $ttl$
    );
  end if;
end
$$;
