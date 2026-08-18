// scripts/backfill-client-events.ts
//
// Backfill client_events for history that already happened.
//
// client_events was demo-only: nothing in production ever wrote it, so a real
// client's Ticker, Hours Saved, Calls Handled, Agent Activity and hero
// sparklines all rendered zero. Migration 0013 + the emit calls in
// /api/agent/postcall and /api/agent/signal fix that going FORWARD. This fills
// in what is already in the source tables so the client opens a populated
// dashboard instead of an empty one.
//
// Sources, and what is honestly derivable from each:
//   lead_postcall           -- opened_at (a call was handled) and, when the
//                              operator answered, resolved_at + choice.
//   jc_sms_conversations    -- last_outbound_at ONLY. The `messages` array has
//                              no per-message timestamps, so per-message events
//                              cannot be dated and are not invented.
//   handoff_signals         -- created_at, for kinds that describe a real
//                              change of hands (internal pings map to nothing).
//
// Every row is written through src/lib/metrics/eventSources.ts, the same module
// the live routes and the DB trigger's wording come from, so a backfilled line
// and a live one are indistinguishable.
//
// Idempotent: source_key carries a unique index (0013) and every write is an
// ignore-on-conflict upsert, so re-running inserts nothing new. Re-running is
// also how you catch up after a trigger outage.
//
// Usage:
//   node --experimental-strip-types scripts/backfill-client-events.ts [--apply]
//
// DRY RUN BY DEFAULT. Without --apply it prints exactly what it would write and
// touches nothing. Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
// (both in .env.local; `set -a && . ./.env.local && set +a` before running).

import { createClient } from '@supabase/supabase-js';
import {
  JC_SESSION_ID,
  postcallOpenedEvent,
  postcallResolvedEvent,
  quoteOutcomeEvent,
  handoffSignalEvent,
  smsOutboundEvent,
  type ClientEventInsert,
} from '../src/lib/metrics/eventSources.ts';

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
  process.exit(1);
}
const supabase = createClient(url, key);

/** Fail loudly. A partial backfill that looks complete is worse than no run. */
function orDie<T>(what: string, res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) {
    console.error(`${what} failed:`, res.error.message);
    process.exit(1);
  }
  return (res.data ?? []) as T;
}

const events: ClientEventInsert[] = [];

// ---------------------------------------------------------------------------
// lead_postcall
// ---------------------------------------------------------------------------

type PostcallRow = {
  id: string; session_id: string | null; lead_id: string | null; kind: string | null;
  choice: string | null; opened_at: string | null; resolved_at: string | null;
  jc_conversation_id: string | null;
};

const postcalls = orDie<PostcallRow[]>('lead_postcall', await supabase
  .from('lead_postcall')
  .select('id, session_id, lead_id, kind, choice, opened_at, resolved_at, jc_conversation_id')
  .order('opened_at', { ascending: true }));

// Names/numbers for the ticker copy. One batched read rather than a query per
// row: these tables are small and this script is run rarely.
type LeadRow = { id: string; phone: string | null; name: string | null };
const leadIds = [...new Set(postcalls.map(p => p.lead_id).filter((v): v is string => !!v))];
const leads = leadIds.length
  ? orDie<LeadRow[]>('client_leads', await supabase
      .from('client_leads').select('id, phone, name').in('id', leadIds))
  : [];
const leadById = new Map(leads.map(l => [l.id, l]));

type ConvRow = { from_number: string; lead_name: string | null; last_outbound_at: string | null };
const convs = orDie<ConvRow[]>('jc_sms_conversations', await supabase
  .from('jc_sms_conversations')
  .select('from_number, lead_name, last_outbound_at')
  .order('created_at', { ascending: true }));
const convByNumber = new Map(convs.map(c => [c.from_number, c]));

for (const pc of postcalls) {
  const lead = pc.lead_id ? leadById.get(pc.lead_id) : undefined;
  if (pc.kind === 'quote') {
    // Quote menus hang off a conversation, not a lead row.
    const conv = pc.jc_conversation_id ? convByNumber.get(pc.jc_conversation_id) : undefined;
    push(quoteOutcomeEvent({
      postcallId: pc.id, sessionId: pc.session_id, kind: pc.kind,
      leadName: conv?.lead_name ?? null, phone: pc.jc_conversation_id,
      resolvedAt: pc.resolved_at, choice: pc.choice,
    }));
    continue;
  }
  push(postcallOpenedEvent({
    postcallId: pc.id, sessionId: pc.session_id, kind: pc.kind,
    leadName: lead?.name ?? null, phone: lead?.phone ?? null,
    openedAt: pc.opened_at,
  }));
  push(postcallResolvedEvent({
    postcallId: pc.id, sessionId: pc.session_id, kind: pc.kind,
    leadName: lead?.name ?? null, phone: lead?.phone ?? null,
    resolvedAt: pc.resolved_at, choice: pc.choice,
  }));
}

// ---------------------------------------------------------------------------
// jc_sms_conversations -- current last_outbound_at only
// ---------------------------------------------------------------------------
//
// One event per conversation, at the last time the agent texted it. Earlier
// outbound texts are unrecoverable: the column holds one instant and the
// message array carries no timestamps at all. From here on the DB trigger
// (0013) records each new distinct value as it happens, so the feed thickens
// forward in time instead of being fabricated backwards.

for (const c of convs) {
  push(smsOutboundEvent({
    sessionId: JC_SESSION_ID,
    fromNumber: c.from_number,
    leadName: c.lead_name,
    lastOutboundAt: c.last_outbound_at,
  }));
}

// ---------------------------------------------------------------------------
// handoff_signals
// ---------------------------------------------------------------------------

type SignalRow = { id: string; session_id: string | null; kind: string | null; created_at: string | null };
const signals = orDie<SignalRow[]>('handoff_signals', await supabase
  .from('handoff_signals')
  .select('id, session_id, kind, created_at')
  .order('created_at', { ascending: true }));

for (const s of signals) {
  push(handoffSignalEvent({ signalId: s.id, sessionId: s.session_id, kind: s.kind, at: s.created_at }));
}

// ---------------------------------------------------------------------------
// Report + write
// ---------------------------------------------------------------------------

function push(event: ClientEventInsert | null): void {
  if (event) events.push(event);
}

events.sort((a, b) => a.created_at.localeCompare(b.created_at));

const bySession = new Map<string, number>();
for (const e of events) bySession.set(e.session_id, (bySession.get(e.session_id) ?? 0) + 1);

console.log(`sources: ${postcalls.length} lead_postcall, ${convs.length} jc_sms_conversations, ${signals.length} handoff_signals`);
console.log(`derived: ${events.length} client_events`);
for (const [session, n] of bySession) console.log(`  ${session}: ${n}`);
for (const e of events) console.log(`  ${e.created_at}  ${e.agent}/${e.kind}  ${e.message}`);

if (!apply) {
  console.log('\ndry run: nothing written. re-run with --apply to insert.');
  process.exit(0);
}

// Ignore-on-conflict: re-running is a no-op, and a partially-applied previous
// run resumes cleanly. Chunked so one oversized request cannot fail the batch.
let inserted = 0;
for (let i = 0; i < events.length; i += 100) {
  const chunk = events.slice(i, i + 100);
  const { data, error } = await supabase
    .from('client_events')
    .upsert(chunk, { onConflict: 'source_key', ignoreDuplicates: true })
    .select('id');
  if (error) {
    console.error('insert failed at chunk', i, error.message);
    process.exit(1);
  }
  inserted += data?.length ?? 0;
}
console.log(`\ninserted ${inserted} new rows (${events.length - inserted} already present)`);
