-- Instant First Responder Demo — demo_sessions
--
-- A prospect enters their website URL + phone on the public /demo lander. We
-- scrape their site, build a First Responder SMS persona in THEIR business voice,
-- and stash it here. They then call ONE shared demo number; caller ID is the join
-- key that maps the inbound call back to this row so we can fire a missed-call
-- text-back in their voice. phone_code is the no-caller-ID fallback (form issues a
-- 4-digit code, prospect texts CODE first, inbound SMS binds their phone).
--
-- Management-API-created tables get NO DML grants by default, so this migration
-- ends with explicit grants to service_role (the only role that touches this
-- table — all access is via trusted server routes / edge functions, never the
-- browser).
--
-- PII hygiene: a pg_cron job expires stale rows and hard-deletes after 7 days.

create table if not exists public.demo_sessions (
  id            uuid primary key default gen_random_uuid(),
  -- E.164 caller-ID join key. Null until a call/text binds it (code-fallback path
  -- inserts the row with phone already set from the form; caller-ID path also
  -- sets it from the form, phone_code is only the fallback binding channel).
  phone         text,
  -- 4-digit no-caller-ID fallback code. Prospect texts this to the demo number to
  -- bind their phone when caller ID is withheld.
  phone_code    char(4),
  website_url   text,
  company       jsonb,
  -- { system_prompt, greeting, business_name, voice }
  fr_config     jsonb,
  status        text not null default 'building'
                  check (status in ('building','ready','texted','failed','expired')),
  brand         jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '24 hours'
);

-- Caller-ID lookup: newest READY row for a phone wins (a prospect can re-run the
-- demo; the latest ready persona is the one their call should hit).
create index if not exists demo_sessions_phone_ready_idx
  on public.demo_sessions (phone, created_at desc)
  where status = 'ready';

-- Code-fallback lookup must be unambiguous: at most one BUILDING row per code.
create unique index if not exists demo_sessions_code_building_idx
  on public.demo_sessions (phone_code)
  where status = 'building' and phone_code is not null;

-- TTL sweep housekeeping.
create index if not exists demo_sessions_expires_idx
  on public.demo_sessions (expires_at);

-- Management-API tables have no default DML grants; grant explicitly.
grant select, insert, update, delete on public.demo_sessions to service_role;

-- TTL job: flip expired non-terminal rows to 'expired', then hard-delete anything
-- older than 7 days (PII hygiene). Runs every 15 minutes. pg_cron is already
-- enabled on this project (archive cleanup uses it).
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
      $ttl$
    );
  end if;
end
$$;
