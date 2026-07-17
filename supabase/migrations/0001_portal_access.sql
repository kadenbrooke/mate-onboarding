-- 0001_portal_access.sql
--
-- Documents and provisions the `portal_access` table the internal auth gates
-- depend on. Both `src/app/(app)/layout.tsx` and
-- `src/app/handoff/[sessionId]/page.tsx` query this table via the anon cookie
-- client (which carries the signed-in user's JWT, so the `authenticated` role
-- applies) and filter on:
--     email = auth.jwt()->>'email'  AND  client_slug = 'mate'
-- If no matching row exists, the gate signs the user out and redirects to
-- /login?error=unauthorized. With NO 'mate' rows, EVERY authenticated user
-- (including the founder) is locked out of /handoff and the (app) dashboard.
--
-- This table was inherited from the forked scaffold and previously had no
-- migration in this app. This migration is ADDITIVE and IDEMPOTENT: it creates
-- the table/policy/grants only if absent and seeds the internal 'mate' rows
-- with ON CONFLICT DO NOTHING. It performs NO destructive change to the live
-- table or to any existing row (e.g. the pre-existing 'ben-barlow' rows).
--
-- Reference (live business project jeqnvdlfybpmbovywknz, verified 2026-07-16):
--   columns   : email text NOT NULL, client_slug text NOT NULL,
--               role text NOT NULL default 'viewer', created_at timestamptz
--                 NOT NULL default now()
--   primary key: (email)   <-- one row per email (scaffold constraint)
--   RLS       : enabled; policy "portal_access_self" grants SELECT to the
--               `authenticated` role where email = auth.jwt()->>'email'
--   grants    : authenticated -> SELECT ; service_role -> full

create table if not exists public.portal_access (
  email       text        not null,
  client_slug text        not null,
  role        text        not null default 'viewer',
  created_at  timestamptz not null default now(),
  constraint portal_access_pkey primary key (email)
);

-- Row-level security: a signed-in user may read ONLY their own row.
alter table public.portal_access enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.portal_access'::regclass
      and polname = 'portal_access_self'
  ) then
    create policy portal_access_self
      on public.portal_access
      for select
      to authenticated
      using (email = (auth.jwt() ->> 'email'));
  end if;
end
$$;

-- Grants: authenticated reads (RLS-scoped to own row); service_role manages.
grant select on public.portal_access to authenticated;
grant select, insert, update, delete on public.portal_access to service_role;

-- Seed the internal allowlist for the 'mate' slug. Only the internal/founder
-- account(s) get access to the handoff brief + (app) dashboard; clients use the
-- public, session-scoped /onboard and /portal surfaces (no portal_access row).
--
-- NOTE: the primary key is (email) alone, so an email can hold only one
-- portal_access row. ON CONFLICT (email) DO NOTHING is intentional: it will NOT
-- overwrite an email that already has a row for a different slug. The seeded
-- emails below currently have no portal_access row, so both inserts apply. If a
-- founder account later needs BOTH a 'mate' and a non-'mate' row, the (email)
-- primary key must first be widened to (email, client_slug).
insert into public.portal_access (email, client_slug, role) values
  ('kaden@auto-mate.business', 'mate', 'admin'),
  ('johnabrooke@gmail.com',    'mate', 'viewer')
on conflict (email) do nothing;
