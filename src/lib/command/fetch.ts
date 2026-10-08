// src/lib/command/fetch.ts
//
// Every read the Command Center makes. Each query is tenant-scoped
// (session_id) and excludes test phones (is_test = false), and each one is
// targeted at exactly the set a card needs instead of slicing the newest N
// leads, so an older lead can never fall off a list it belongs on:
//
//   fetchCallNow           Call now: the live-score view ordered by score in
//                          SQL, paged until the top 5 open leads are settled.
//                          Global ranking, bounded by CALL_MAX_PAGES.
//   fetchWaitingCandidates Waiting on you: three windowed queries (arrived in
//                          24h, handed off in 48h, lead texted in REPLY_LOOKBACK_DAYS).
//   fetchStuckCandidates   Stuck: every won lead (for money owed) and every
//                          quote older than QUOTE_STALE_DAYS. Complete sets.
//   fetchLeadSignals       live score + reasons for given ids.
//   fetchLastOutbound      newest outbound message per lead, one limit(1)
//                          query per lead, so no lead's history can crowd out
//                          another's.
//   fetchPaidByLead        payments summed per lead.
//
// Failures return null / 'missing' / 'error' (logged) rather than a guess;
// commandCenter.ts decides what an unknown means for each list. No writes.

import type { Lead } from '@/lib/metrics/leads';
import { callList, isClosed, QUOTE_STALE_DAYS, type LeadSignal } from './commandCenter';

type QueryError = { message: string; code?: string };
type Result<T> = { data: T[] | null; error: QueryError | null };

/** The query-builder surface these reads use. The Supabase client satisfies it
 *  (pages cast through unknown); tests pass a stateful in-memory fake. */
export interface Query<T> extends PromiseLike<Result<T>> {
  eq(col: string, v: string | boolean): Query<T>;
  in(col: string, vs: string[]): Query<T>;
  gte(col: string, v: string | number): Query<T>;
  lt(col: string, v: string): Query<T>;
  is(col: string, v: null): Query<T>;
  order(col: string, o: { ascending: boolean }): Query<T>;
  limit(n: number): Query<T>;
  range(from: number, to: number): Query<T>;
}
export type CommandDb = { from(table: string): { select(cols: string): Query<Record<string, unknown>> } };

export const CHUNK = 100;
/** Score-view rows read per Call now page, and the most pages read. */
export const CALL_PAGE = 50;
export const CALL_MAX_PAGES = 10;
/** Upper bound on each Waiting / Stuck candidate query. */
export const CANDIDATE_CAP = 500;
/** An unanswered text from a lead counts for this long. */
export const REPLY_LOOKBACK_DAYS = 30;
/** Parallel per-lead outbound reads. */
export const OUTBOUND_CONCURRENCY = 8;

const SIGNAL_COLS = 'lead_id, score, tier, timeframe, last_lead_reply_at';
const MISSING_CODES = new Set(['PGRST205', '42P01']);
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const leadsTable = (db: CommandDb, sessionId: string) =>
  db.from('client_leads').select('*').eq('session_id', sessionId).eq('is_test', false);

function logFail(what: string, e: QueryError | null) {
  console.error(`[command] ${what} read failed:`, e?.code ?? '', e?.message ?? 'no data');
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

/** Leads by id, tenant-scoped, test phones out. null on a failed read. */
export async function fetchLeadsByIds(db: CommandDb, sessionId: string, ids: string[]): Promise<Lead[] | null> {
  if (ids.length === 0) return [];
  const results = await Promise.all(chunks(ids).map(c => leadsTable(db, sessionId).in('id', c)));
  const failed = results.find(r => r.error || !r.data);
  if (failed) { logFail('client_leads', failed.error); return null; }
  return results.flatMap(r => r.data as unknown as Lead[]);
}

export type LeadSignals =
  | { status: 'live'; signals: Map<string, LeadSignal> }
  | { status: 'missing' }
  | { status: 'error' };

/** Live score + reasons for exactly these leads. */
export async function fetchLeadSignals(db: CommandDb, sessionId: string, ids: string[]): Promise<LeadSignals> {
  if (ids.length === 0) return { status: 'live', signals: new Map() };
  const results = await Promise.all(chunks(ids).map(c =>
    db.from('client_lead_scores').select(SIGNAL_COLS).eq('session_id', sessionId).in('lead_id', c),
  ));
  const failed = results.find(r => r.error || !r.data);
  if (failed) {
    if (failed.error?.code && MISSING_CODES.has(failed.error.code)) return { status: 'missing' };
    logFail('client_lead_scores', failed.error);
    return { status: 'error' };
  }
  const signals = new Map<string, LeadSignal>();
  for (const r of results) for (const row of r.data as unknown as LeadSignal[]) signals.set(row.lead_id, row);
  return { status: 'live', signals };
}

export type CallNow =
  | { status: 'live'; leads: Lead[]; signals: Map<string, LeadSignal>; scored: boolean }
  | { status: 'error' };

/**
 * The true top 5 open leads by live score across the tenant's whole book.
 * Reads the score view ordered by score (ties by lead_id, so pages are
 * stable), CALL_PAGE rows at a time, loads those leads, and drops closed
 * ones. Stops once 5 open leads are held and the page's lowest score is
 * below the 5th (so no tie can still be waiting on a later page), when the
 * view runs out, or after CALL_MAX_PAGES. Before migration 0020 is applied it
 * ranks on the stored client_leads.score the same way (the demo's seed).
 */
export async function fetchCallNow(db: CommandDb, sessionId: string): Promise<CallNow> {
  let useView = true;
  const open: Lead[] = [];
  const signals = new Map<string, LeadSignal>();
  let scored = false;

  for (let page = 0; page < CALL_MAX_PAGES; page++) {
    const from = page * CALL_PAGE;
    let pageScores: number[];
    if (useView) {
      const r = await db.from('client_lead_scores').select(SIGNAL_COLS)
        .eq('session_id', sessionId).gte('score', 0)
        .order('score', { ascending: false }).order('lead_id', { ascending: true })
        .range(from, from + CALL_PAGE - 1);
      if (r.error || !r.data) {
        if (page === 0 && r.error?.code && MISSING_CODES.has(r.error.code)) { useView = false; page--; continue; }
        logFail('client_lead_scores (call now)', r.error);
        return { status: 'error' };
      }
      const rows = r.data as unknown as LeadSignal[];
      const leads = await fetchLeadsByIds(db, sessionId, rows.map(x => x.lead_id));
      if (!leads) return { status: 'error' };
      const byId = new Map(leads.map(l => [l.id, l]));
      for (const row of rows) {
        const l = byId.get(row.lead_id);
        if (!l) continue; // a test phone, or not this tenant's
        scored = true;
        signals.set(row.lead_id, row);
        if (!isClosed(l)) open.push({ ...l, score: row.score });
      }
      pageScores = rows.map(x => x.score ?? 0);
    } else {
      const r = await leadsTable(db, sessionId).gte('score', 0)
        .order('score', { ascending: false }).order('id', { ascending: true })
        .range(from, from + CALL_PAGE - 1);
      if (r.error || !r.data) { logFail('client_leads (call now)', r.error); return { status: 'error' }; }
      const rows = r.data as unknown as Lead[];
      if (rows.length) scored = true;
      for (const l of rows) if (!isClosed(l)) open.push(l);
      pageScores = rows.map(l => l.score ?? 0);
    }
    if (pageScores.length < CALL_PAGE) break;
    const top = callList(open);
    if (top.length === 5 && pageScores[pageScores.length - 1] < top[4].score!) break;
  }
  return { status: 'live', leads: callList(open), signals, scored };
}

export type WaitingCandidates = { leads: Lead[]; signals: Map<string, LeadSignal> };

/**
 * Every lead that could be waiting on the owner, from three windowed,
 * tenant-scoped queries: arrived in the last 24h, handed to a person in the
 * last 48h, and texted in within REPLY_LOOKBACK_DAYS (covers both "replied"
 * and an unanswered text on a handed-off lead). waitingOnMe applies the exact
 * rules; this only gathers. Each query is capped at CANDIDATE_CAP. A failed
 * window is logged and skipped, so one bad read empties a bucket instead of
 * the whole card. Returns signals for every candidate.
 */
export async function fetchWaitingCandidates(db: CommandDb, sessionId: string, now: Date): Promise<WaitingCandidates> {
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const [arrived, handed, replied] = await Promise.all([
    leadsTable(db, sessionId).gte('created_at', iso(24 * HOUR_MS))
      .order('created_at', { ascending: false }).limit(CANDIDATE_CAP),
    leadsTable(db, sessionId).eq('handler', 'human').gte('handler_changed_at', iso(48 * HOUR_MS))
      .order('handler_changed_at', { ascending: false }).limit(CANDIDATE_CAP),
    db.from('client_lead_scores').select(SIGNAL_COLS).eq('session_id', sessionId)
      .gte('last_lead_reply_at', iso(REPLY_LOOKBACK_DAYS * DAY_MS))
      .order('last_lead_reply_at', { ascending: false }).limit(CANDIDATE_CAP),
  ]);
  const byId = new Map<string, Lead>();
  const signals = new Map<string, LeadSignal>();
  for (const [name, r] of [['arrived', arrived], ['handed', handed]] as const) {
    if (r.error || !r.data) { logFail(`client_leads (${name})`, r.error); continue; }
    for (const l of r.data as unknown as Lead[]) byId.set(l.id, l);
  }
  if (replied.error || !replied.data) {
    if (!(replied.error?.code && MISSING_CODES.has(replied.error.code))) logFail('client_lead_scores (replied)', replied.error);
  } else {
    const rows = replied.data as unknown as LeadSignal[];
    for (const s of rows) signals.set(s.lead_id, s);
    const missing = rows.map(s => s.lead_id).filter(id => !byId.has(id));
    for (const l of (await fetchLeadsByIds(db, sessionId, missing)) ?? []) byId.set(l.id, l);
  }
  const needSignals = [...byId.keys()].filter(id => !signals.has(id));
  const more = await fetchLeadSignals(db, sessionId, needSignals);
  if (more.status === 'live') for (const [id, s] of more.signals) signals.set(id, s);
  // Only leads that are really this tenant's (fetchLeadsByIds re-scoped them).
  for (const id of [...signals.keys()]) if (!byId.has(id)) signals.delete(id);
  return { leads: [...byId.values()], signals };
}

export type StuckCandidates = {
  /** Every won lead. null when job outcomes are unreadable (0021 not applied, or an error). */
  won: Lead[] | null;
  /** Every open quote untouched for QUOTE_STALE_DAYS. null on a failed read. */
  staleQuotes: Lead[] | null;
};

/** The complete owed and stale sets for the Stuck card (each capped at CANDIDATE_CAP). */
export async function fetchStuckCandidates(db: CommandDb, sessionId: string, now: Date): Promise<StuckCandidates> {
  const cutoff = new Date(now.getTime() - QUOTE_STALE_DAYS * DAY_MS).toISOString();
  const [won, staleStamped, staleUnstamped] = await Promise.all([
    leadsTable(db, sessionId).eq('job_outcome', 'won')
      .order('created_at', { ascending: false }).limit(CANDIDATE_CAP),
    leadsTable(db, sessionId).eq('status', 'quoted').lt('status_updated_at', cutoff)
      .order('status_updated_at', { ascending: true }).limit(CANDIDATE_CAP),
    leadsTable(db, sessionId).eq('status', 'quoted').is('status_updated_at', null).lt('created_at', cutoff)
      .order('created_at', { ascending: true }).limit(CANDIDATE_CAP),
  ]);
  let wonLeads: Lead[] | null = null;
  if (won.error || !won.data) {
    if (won.error?.code !== '42703') logFail('client_leads (won)', won.error); // 42703: 0021 not applied
  } else wonLeads = won.data as unknown as Lead[];
  let stale: Lead[] | null = null;
  if (staleStamped.error || !staleStamped.data) logFail('client_leads (stale quotes)', staleStamped.error);
  else if (staleUnstamped.error || !staleUnstamped.data) logFail('client_leads (stale quotes, unstamped)', staleUnstamped.error);
  else stale = [...staleStamped.data, ...staleUnstamped.data] as unknown as Lead[];
  return { won: wonLeads, staleQuotes: stale };
}

/**
 * Newest outbound message time per lead. One tenant-scoped limit(1) query per
 * lead (OUTBOUND_CONCURRENCY at a time, on the (lead_id, created_at desc)
 * index), so a lead with a long history can never push another lead's newest
 * message out of a shared row cap. Callers pass only open, human-handled
 * leads that have texted in. null when any read failed.
 */
export async function fetchLastOutbound(db: CommandDb, sessionId: string, ids: string[]): Promise<Map<string, string> | null> {
  const newest = new Map<string, string>();
  let failed = false;
  for (let i = 0; i < ids.length && !failed; i += OUTBOUND_CONCURRENCY) {
    const batch = ids.slice(i, i + OUTBOUND_CONCURRENCY);
    const results = await Promise.all(batch.map(id =>
      db.from('lead_messages').select('lead_id, created_at')
        .eq('session_id', sessionId).eq('lead_id', id).eq('direction', 'outbound')
        .order('created_at', { ascending: false }).limit(1),
    ));
    for (const r of results) {
      if (r.error || !r.data) { logFail('lead_messages', r.error); failed = true; break; }
      const row = r.data[0] as { lead_id: string; created_at: string } | undefined;
      if (row) newest.set(row.lead_id, row.created_at);
    }
  }
  return failed ? null : newest;
}

/** Cash recorded per lead (refunds are negative rows). null when any read failed. */
export async function fetchPaidByLead(db: CommandDb, sessionId: string, ids: string[]): Promise<Map<string, number> | null> {
  if (ids.length === 0) return new Map();
  const results = await Promise.all(chunks(ids).map(c =>
    db.from('client_lead_payments').select('lead_id, amount_cents').eq('session_id', sessionId).in('lead_id', c),
  ));
  const failed = results.find(r => r.error || !r.data);
  if (failed) {
    if (!(failed.error?.code && MISSING_CODES.has(failed.error.code))) logFail('client_lead_payments', failed.error);
    return null;
  }
  const paid = new Map<string, number>();
  for (const r of results) {
    for (const row of r.data as { lead_id: string; amount_cents: number | string }[]) {
      const amount = Number(row.amount_cents);
      if (Number.isFinite(amount)) paid.set(row.lead_id, (paid.get(row.lead_id) ?? 0) + amount);
    }
  }
  return paid;
}
