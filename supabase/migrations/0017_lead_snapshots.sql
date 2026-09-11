-- 0017_lead_snapshots.sql
--
-- Lead Snapshot (DEL-38): a client photographs a note containing lead details,
-- a vision model reads it, a human confirms it, and the confirmed rows enter the
-- same ingest path a Meta Lead Ads lead already uses.
--
-- Spec: amos repo, projects/deployed/mate-onboarding/lead-snapshot-spec.md
--
-- Numbering note: the spec says 0016. That number was taken by
-- 0016_agent_metrics_instrumentation.sql before this got built, so this is 0017.
--
-- Everything here is additive and idempotent. No column is dropped, no row is
-- deleted, and nothing reads the new send_after column until the Phase B
-- lead-intake workflow ships (see section 3).

-- ---------------------------------------------------------------------------
-- 1. lead_snapshots
-- ---------------------------------------------------------------------------
--
-- RLS stays disabled, matching client_leads / onboarding_sessions in this app.
-- Every read and write goes through a service-role route behind checkDashApiAccess.
--
-- The image is the consent artifact, so the row is retained after extraction
-- rather than cleaned up. If a complaint arrives about a text, this table plus
-- the stored image is the record of who uploaded it and what they attested to.

create table if not exists public.lead_snapshots (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.onboarding_sessions(id) on delete cascade,
  uploaded_by   uuid,
  storage_path  text not null,
  status        text not null default 'extracting'
                check (status in ('extracting','ready','confirmed','discarded','failed')),
  extracted     jsonb,
  confirmed     jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz
);

comment on table public.lead_snapshots is
  'Lead Snapshot uploads. One row per uploaded image. extracted holds the raw '
  'vision candidates, confirmed holds what the human actually sent plus the '
  'consent attestation. The image in storage is the consent evidence.';

comment on column public.lead_snapshots.uploaded_by is
  'auth.users.id of the member who confirmed the send. Part of the consent record.';

comment on column public.lead_snapshots.storage_path is
  'Bucket-relative path in the private lead-snapshots bucket: '
  '<session_id>/<snapshot_id>/<n>.<ext>. Never served as a public URL.';

create index if not exists lead_snapshots_session_idx
  on public.lead_snapshots (session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Private storage bucket
-- ---------------------------------------------------------------------------
--
-- public = false, so there is no anonymous object URL. Reads are served through
-- a signed URL minted server-side inside the auth gate.
--
-- No storage.objects RLS policies are added on purpose: with no policy, only the
-- service role can touch the bucket, which is exactly the access model we want.
-- The browser never holds a key that can read these images.

insert into storage.buckets (id, name, public)
values ('lead-snapshots', 'lead-snapshots', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. jc_sms_conversations.send_after -- the Lead Snapshot release condition
-- ---------------------------------------------------------------------------
--
-- THE PROBLEM THIS SOLVES. Snapshot leads must honour quiet hours: a number
-- photographed off a handwritten note did not reach out to us, so it queues
-- until 08:00 America/Denver rather than texting a stranger at 2am.
--
-- Until 2026-08-25 a held row could rely on the shared drain to enforce that.
-- MyTAmqQsLDUtAyep runs Intro Pending Query -> Compute -> Send -> Clear on a
-- 15 minute cron, and Compute used to apply its own send-window check. That
-- check was deliberately REMOVED when quiet hours were redefined as "gate
-- outreach we initiate, not replies to leads who reached out": a Meta form
-- submission counts as the lead reaching out, so form intros now fire at any
-- hour and the drain became hour-blind by design.
--
-- So the drain will happily send a held snapshot lead at 2am. Lead Snapshot
-- needs a release condition of its own.
--
-- THE DECISION (spec left this open for Phase B, resolved here). Carry an
-- explicit send_after timestamp on the row rather than re-adding a window check
-- to the drain. Reasons:
--
--   a. Re-adding a window check to Compute would re-gate FORM leads too, which
--      is the exact behaviour the founder removed on 2026-08-25. The drain is
--      shared, so a change there is never scoped to one source.
--   b. A timestamp is per-row, so each source states its own policy at seed
--      time and the drain stays a dumb, source-agnostic pump.
--   c. It is inspectable. "Why has this not sent" is answered by reading one
--      column, not by reasoning about what hour the cron last fired in.
--   d. It is inert until used. A null send_after means "no hold", which is
--      every row that exists today, so this column changes no current behaviour.
--
-- WHAT IS NOT DONE HERE. Nothing reads send_after yet. The Phase B lead-intake
-- workflow writes it, and the drain's Intro Pending Query gains
--   and (send_after is null or send_after <= now())
-- as a separate, separately-gated n8n change with a timestamped snapshot into
-- departments/customer-success/clients/jc-asphalt-paving/n8n-restore/ first.
-- Adding the column now is safe precisely because it is additive and unread.

alter table public.jc_sms_conversations
  add column if not exists send_after timestamptz;

comment on column public.jc_sms_conversations.send_after is
  'Earliest time this row is allowed to send its held intro. Null means no '
  'hold, which is the default and covers every pre-existing row. Set by the '
  'lead-intake workflow for Lead Snapshot leads so they honour quiet hours '
  'without re-gating form leads, whose intro is deliberately hour-blind since '
  '2026-08-25. Read by the Intro Pending drain (MyTAmqQsLDUtAyep).';

-- Partial index: the drain only ever asks about rows that are actually held.
create index if not exists jc_sms_conversations_send_after_idx
  on public.jc_sms_conversations (send_after)
  where send_after is not null;

-- ---------------------------------------------------------------------------
-- 4. next_send_window_start -- SQL mirror of nextSendWindowStart() in TS
-- ---------------------------------------------------------------------------
--
-- Mirrors nextSendWindowStart() in src/lib/agent/quietHours.ts so the TS write
-- path and any SQL-side backfill agree on when a held row is allowed out.
-- Window is 08:00 to 20:00 America/Denver, Sunday blocked, matching the
-- QuietHours config the agent already uses.
--
-- Returns the input unchanged when it already sits inside the window.

create or replace function public.next_send_window_start(p_at timestamptz)
returns timestamptz
language plpgsql
immutable
as $$
declare
  local_ts  timestamp;
  candidate timestamp;
  dow       integer;
begin
  if p_at is null then
    return null;
  end if;

  local_ts := p_at at time zone 'America/Denver';
  candidate := local_ts;

  -- At most 8 hops: each iteration either moves to 08:00 today or to the next
  -- day, so a Saturday 21:00 start settles on Monday 08:00 well inside the bound.
  for _i in 1..8 loop
    dow := extract(dow from candidate);   -- 0 = Sunday

    if dow = 0 then
      candidate := date_trunc('day', candidate) + interval '1 day' + interval '8 hours';
    elsif candidate::time < time '08:00' then
      candidate := date_trunc('day', candidate) + interval '8 hours';
    elsif candidate::time >= time '20:00' then
      candidate := date_trunc('day', candidate) + interval '1 day' + interval '8 hours';
    else
      return candidate at time zone 'America/Denver';
    end if;
  end loop;

  return candidate at time zone 'America/Denver';
end;
$$;
