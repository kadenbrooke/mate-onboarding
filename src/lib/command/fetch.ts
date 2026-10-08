// src/lib/command/fetch.ts
//
// Every read the Command Center makes. Rule: no card may silently drop a row
// it claims to show. So:
//
//   * eligibility is filtered in SQL (tenant, is_test = false, and for open
//     leads: not serviced, no won/lost), so a scan only ever sees candidates;
//   * every list read is paged to exhaustion (scanAll), in pages no bigger
//     than PostgREST's default 1000-row response cap;
//   * the one ceiling left (MAX_PAGES, far above any client's volume) is
//     never silent: a scan that hits it reports complete = false and the
//     card says "More not shown".
//
// The reads:
//   fetchOpenBook     every open lead + its live-score row. Call now, Waiting
//                     on you and stale quotes are all computed from this one
//                     complete set (commandCenter.ts).
//   fetchWonLeads     every lead marked won, for the money-owed rows.
//   fetchPaidByLead   payments summed per lead.
//   fetchLastOutbound newest outbound message per lead after a given time,
//                     batched per chunk of ids and paged, so no lead's
//                     history can crowd out another's.
//
// Failures return null / { error } (logged) rather than a guess. No writes.

import type { Lead } from '@/lib/metrics/leads';
import { mergeLiveScores } from '@/lib/leads/liveScores';
import type { LeadSignal } from './commandCenter';

type QueryError = { message: string; code?: string };
type Result<T> = { data: T[] | null; error: QueryError | null };

/** The query-builder surface these reads use. The Supabase client satisfies it
 *  (pages cast through unknown); tests pass a stateful in-memory fake. */
export interface Query<T> extends PromiseLike<Result<T>> {
  eq(col: string, v: string | boolean): Query<T>;
  neq(col: string, v: string): Query<T>;
  in(col: string, vs: string[]): Query<T>;
  gt(col: string, v: string): Query<T>;
  is(col: string, v: null): Query<T>;
  order(col: string, o: { ascending: boolean }): Query<T>;
  range(from: number, to: number): Query<T>;
}
export type CommandDb = { from(table: string): { select(cols: string): Query<Record<string, unknown>> } };

/** Rows per page. Must not exceed PostgREST's max-rows (1000 on Supabase). */
export const PAGE = 1000;
/** Pages per scan before it reports itself incomplete (20,000 rows). */
export const MAX_PAGES = 20;
/** Ids per `in (...)` filter, keeping the URL around 4 KB. */
export const CHUNK = 100;

const SIGNAL_COLS = 'lead_id, score, tier, timeframe, last_lead_reply_at';
const MISSING_CODES = new Set(['PGRST205', '42P01']);
/** Postgres "column does not exist": job outcomes (0021) not applied yet. */
const NO_COLUMN = '42703';

export type Scan<T> = { rows: T[]; complete: boolean } | { error: QueryError };

/**
 * Read every row a query matches, PAGE rows at a time. `build` must order by
 * a unique key so pages neither overlap nor skip. Stops at a short page
 * (complete) or after MAX_PAGES full pages (complete = false).
 */
export async function scanAll<T>(build: () => Query<T>): Promise<Scan<T>> {
  const rows: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const r = await build().range(p * PAGE, p * PAGE + PAGE - 1);
    if (r.error || !r.data) return { error: r.error ?? { message: 'no data' } };
    rows.push(...r.data);
    if (r.data.length < PAGE) return { rows, complete: true };
  }
  return { rows, complete: false };
}

function logFail(what: string, e: QueryError | null | undefined) {
  console.error(`[command] ${what} read failed:`, e?.code ?? '', e?.message ?? 'no data');
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

const leadsTable = (db: CommandDb, sessionId: string) =>
  db.from('client_leads').select('*').eq('session_id', sessionId).eq('is_test', false);

export type OpenBook = {
  /** Every open lead, live score merged in (stored score before 0020). */
  leads: Lead[];
  /** Score-view rows for those leads (empty before 0020 or on a read error). */
  signals: Map<string, LeadSignal>;
  /** False when the scan hit MAX_PAGES. */
  complete: boolean;
};

/**
 * Every open lead for the tenant (not a test phone, not serviced, not marked
 * won or lost; all in SQL), plus each one's live-score row. null on a failed
 * lead read. Before 0021 there is no job_outcome column, and no outcomes, so
 * the scan runs without that one predicate.
 */
export async function fetchOpenBook(db: CommandDb, sessionId: string): Promise<OpenBook | null> {
  const open = (withOutcome: boolean) => () => {
    let q = leadsTable(db, sessionId).neq('status', 'serviced');
    if (withOutcome) q = q.is('job_outcome', null);
    return q.order('id', { ascending: true });
  };
  let scan = await scanAll(open(true));
  if ('error' in scan && scan.error.code === NO_COLUMN) scan = await scanAll(open(false));
  if ('error' in scan) { logFail('client_leads (open)', scan.error); return null; }
  const leads = scan.rows as unknown as Lead[];

  const results = await Promise.all(chunks(leads.map(l => l.id)).map(c =>
    db.from('client_lead_scores').select(SIGNAL_COLS).eq('session_id', sessionId).in('lead_id', c),
  ));
  const failed = results.find(r => r.error || !r.data);
  const signals = new Map<string, LeadSignal>();
  let merged: Lead[];
  if (!failed) {
    for (const r of results) for (const row of r.data as unknown as LeadSignal[]) signals.set(row.lead_id, row);
    merged = mergeLiveScores(leads, {
      status: 'live', scores: new Map([...signals].map(([id, s]) => [id, s.score])),
    });
  } else if (failed.error?.code && MISSING_CODES.has(failed.error.code)) {
    merged = mergeLiveScores(leads, { status: 'missing' });
  } else {
    logFail('client_lead_scores', failed.error);
    merged = mergeLiveScores(leads, { status: 'error' });
  }
  return { leads: merged, signals, complete: scan.complete };
}

/** Every lead marked won. Before 0021 there is no job_outcome column and so no
 *  won leads: an empty, complete list. null on a failed read. */
export async function fetchWonLeads(db: CommandDb, sessionId: string): Promise<{ leads: Lead[]; complete: boolean } | null> {
  const scan = await scanAll(() => leadsTable(db, sessionId).eq('job_outcome', 'won').order('id', { ascending: true }));
  if ('error' in scan) {
    if (scan.error.code === NO_COLUMN) return { leads: [], complete: true };
    logFail('client_leads (won)', scan.error);
    return null;
  }
  return { leads: scan.rows as unknown as Lead[], complete: scan.complete };
}

/** Cash recorded per lead (refunds are negative rows). null when any read
 *  failed or was incomplete: a partial sum would show paid jobs as owing. */
export async function fetchPaidByLead(db: CommandDb, sessionId: string, ids: string[]): Promise<Map<string, number> | null> {
  const paid = new Map<string, number>();
  for (const c of chunks(ids)) {
    const scan = await scanAll(() => db.from('client_lead_payments').select('id, lead_id, amount_cents')
      .eq('session_id', sessionId).in('lead_id', c).order('id', { ascending: true }));
    if ('error' in scan) {
      if (!(scan.error.code && MISSING_CODES.has(scan.error.code))) logFail('client_lead_payments', scan.error);
      return null;
    }
    if (!scan.complete) { logFail('client_lead_payments (over page ceiling)', null); return null; }
    for (const row of scan.rows as { lead_id: string; amount_cents: number | string }[]) {
      const amount = Number(row.amount_cents);
      if (Number.isFinite(amount)) paid.set(row.lead_id, (paid.get(row.lead_id) ?? 0) + amount);
    }
  }
  return paid;
}

/**
 * Newest outbound message per lead, among messages strictly after `since`.
 * Waiting on you only asks "has anyone answered since the lead's last text?",
 * so the caller passes the earliest such text and anything older is
 * irrelevant: a lead with no row here had no outbound after `since`, hence
 * none after its own (later) text either.
 *
 * One query per chunk of CHUNK ids, ordered (lead_id, created_at desc, id)
 * and paged to exhaustion, so a chatty lead can never push another lead's
 * newest message out of a row cap. Uses lead_messages (lead_id, created_at).
 * null when any read failed or hit the page ceiling.
 */
export async function fetchLastOutbound(
  db: CommandDb, sessionId: string, ids: string[], since: string,
): Promise<Map<string, string> | null> {
  const newest = new Map<string, string>();
  for (const c of chunks(ids)) {
    const scan = await scanAll(() => db.from('lead_messages').select('id, lead_id, created_at')
      .eq('session_id', sessionId).in('lead_id', c).eq('direction', 'outbound').gt('created_at', since)
      .order('lead_id', { ascending: true }).order('created_at', { ascending: false }).order('id', { ascending: true }));
    if ('error' in scan) { logFail('lead_messages', scan.error); return null; }
    if (!scan.complete) { logFail('lead_messages (over page ceiling)', null); return null; }
    for (const row of scan.rows as { lead_id: string; created_at: string }[]) {
      if (!newest.has(row.lead_id)) newest.set(row.lead_id, row.created_at);
    }
  }
  return newest;
}
