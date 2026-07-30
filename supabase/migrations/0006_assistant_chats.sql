-- Assistant view: saved chat threads + messages, scoped to an onboarding session.
-- Access is enforced in the app (requireDashAccess / service-role routes); RLS is
-- disabled here to match the existing client_leads/onboarding_sessions pattern in
-- this app (all writes go through service-role route handlers).

create table if not exists assistant_chats (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references onboarding_sessions(id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_assistant_chats_session
  on assistant_chats(session_id, updated_at desc);

create table if not exists assistant_messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references assistant_chats(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_assistant_messages_chat
  on assistant_messages(chat_id, created_at asc);
