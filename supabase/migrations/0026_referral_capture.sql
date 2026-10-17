-- Referral capture (founder gate: write this file only; do not apply during the
-- interrupted Mac-migration recovery). The registry belongs with tenant data,
-- next to onboarding_sessions and client_leads, so a dedicated deployment can
-- serve its own referral links without crossing into another client's rows.

create table if not exists public.referral_codes (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.onboarding_sessions(id) on delete cascade,
  code           text not null check (code = upper(code) and length(code) between 8 and 32),
  referrer_name  text not null check (length(btrim(referrer_name)) between 1 and 200),
  referrer_email text,
  referrer_phone text,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

create unique index if not exists referral_codes_code_uq on public.referral_codes (lower(code));
create index if not exists referral_codes_session_idx on public.referral_codes (session_id, created_at desc);

alter table public.client_leads add column if not exists referral_code text;
create index if not exists client_leads_referral_code_idx
  on public.client_leads (session_id, referral_code)
  where referral_code is not null;

grant select, insert, update on public.referral_codes to service_role;

-- Referral codes contain referrer contact details. PostgREST must never expose
-- them through the publishable key; all access is through trusted server routes.
alter table public.referral_codes enable row level security;
revoke all on table public.referral_codes from anon, authenticated;

-- Store one privacy-preserving attempt receipt per code/IP so the public form
-- can enforce abuse caps without retaining raw IP addresses.
create table if not exists public.referral_capture_attempts (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.onboarding_sessions(id) on delete cascade,
  referral_code text not null,
  ip_hash       text not null,
  code_counted  boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table public.referral_capture_attempts
  add column if not exists code_counted boolean not null default true;

create index if not exists referral_attempts_code_day_idx
  on public.referral_capture_attempts (referral_code, created_at desc);
create index if not exists referral_attempts_ip_day_idx
  on public.referral_capture_attempts (ip_hash, created_at desc);

alter table public.referral_capture_attempts enable row level security;
revoke all on table public.referral_capture_attempts from anon, authenticated;
grant select, insert on table public.referral_capture_attempts to service_role;

-- Atomically reserve an attempt. The advisory locks serialize requests sharing
-- a code or IP, so a burst cannot pass the count checks concurrently. Invalid
-- submissions set p_count_for_code=false: they still consume the IP budget but
-- do not consume the code's accepted-submission budget.
create or replace function public.claim_referral_capture_attempt(
  p_session_id uuid,
  p_referral_code text,
  p_ip_hash text,
  p_count_for_code boolean
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  code_count integer;
  ip_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('referral-code:' || p_referral_code, 0));
  perform pg_advisory_xact_lock(hashtextextended('referral-ip:' || p_ip_hash, 0));

  select count(*)::integer into ip_count
    from public.referral_capture_attempts
   where ip_hash = p_ip_hash and created_at >= day_start;
  if ip_count >= 20 then
    return 'ip';
  end if;

  if p_count_for_code then
    select count(*)::integer into code_count
      from public.referral_capture_attempts
     where referral_code = p_referral_code
       and code_counted
       and created_at >= day_start;
    if code_count >= 100 then
      insert into public.referral_capture_attempts (session_id, referral_code, ip_hash, code_counted)
      values (p_session_id, p_referral_code, p_ip_hash, false);
      return 'code';
    end if;
  end if;

  insert into public.referral_capture_attempts (session_id, referral_code, ip_hash, code_counted)
  values (p_session_id, p_referral_code, p_ip_hash, p_count_for_code);
  return 'ok';
end;
$$;

revoke all on function public.claim_referral_capture_attempt(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_referral_capture_attempt(uuid, text, text, boolean) to service_role;

