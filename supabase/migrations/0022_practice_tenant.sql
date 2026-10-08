-- 0022_practice_tenant.sql
--
-- Marks a tenant as a provider-free practice company. The app reads this
-- server-side before every dashboard-originated outbound action. The default
-- keeps every existing tenant live and changes no rows.

alter table public.onboarding_sessions
  add column if not exists is_practice boolean not null default false;

create index if not exists onboarding_sessions_practice_idx
  on public.onboarding_sessions (id)
  where is_practice = true;

comment on column public.onboarding_sessions.is_practice is
  'Provider-free training tenant. Outbound text, call, and email actions must be recorded as fake practice receipts.';
