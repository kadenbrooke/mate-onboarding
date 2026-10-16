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

