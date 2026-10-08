// src/lib/command/fetch.ts
//
// The three reads the Command Center adds on top of what /dash already loads.
// All tenant-scoped (session_id) AND id-scoped to the leads the page loaded,
// chunked like fetchLiveScores so the PostgREST URL stays small. No writes.
//
//   fetchLeadSignals   client_lead_scores (0020): the live score plus the
//                      columns behind it (tier, timeframe, last reply), so the
//                      screen can say WHY a lead is hot. Also yields the
//                      LiveScores that mergeLiveScores expects, so the score
//                      is read once.
//   fetchLastOutbound  newest outbound lead_messages row per lead, for "has
//                      anyone answered this lead's last text?"
//   fetchPaidByLead    client_lead_payments (0021) summed per lead, for
//                      "how much does this won job still owe?"
//
// Each returns null (or 'missing' / 'error') rather than guessing on failure;
// commandCenter.ts decides what an unknown means for each list.

import type { LiveScores } from '@/lib/leads/liveScores';
import type { LeadSignal } from './commandCenter';

type QueryError = { message: string; code?: string };
type Res<T> = PromiseLike<{ data: T[] | null; error: QueryError | null }>;

export const CHUNK = 100;
// Rows per outbound read. An answered lead usually has a handful of outbound
// texts; the newest per lead is all that is kept.
export const OUTBOUND_ROW_CAP = 1000;

const MISSING_CODES = new Set(['PGRST205', '42P01']);

const SIGNAL_COLS = 'lead_id, score, tier, timeframe, last_lead_reply_at' as const;

export type SignalQuery = {
  from(table: 'client_lead_scores'): {
    select(cols: typeof SIGNAL_COLS): {
      eq(col: 'session_id', v: string): { in(col: 'lead_id', ids: string[]): Res<LeadSignal> };
    };
  };
};

type OutboundRow = { lead_id: string; created_at: string };
export type OutboundQuery = {
  from(table: 'lead_messages'): {
    select(cols: 'lead_id, created_at'): {
      eq(col: 'session_id', v: string): {
        eq(col: 'direction', v: 'outbound'): {
          in(col: 'lead_id', ids: string[]): {
            order(col: 'created_at', o: { ascending: false }): { limit(n: number): Res<OutboundRow> };
          };
        };
      };
    };
  };
};

type PaymentRow = { lead_id: string; amount_cents: number | string };
export type PaymentQuery = {
  from(table: 'client_lead_payments'): {
    select(cols: 'lead_id, amount_cents'): {
      eq(col: 'session_id', v: string): { in(col: 'lead_id', ids: string[]): Res<PaymentRow> };
    };
  };
};

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

export type LeadSignals =
  | { status: 'live'; signals: Map<string, LeadSignal> }
  | { status: 'missing' }
  | { status: 'error' };

/** Live score + reasons for exactly these leads. */
export async function fetchLeadSignals(q: SignalQuery, sessionId: string, leadIds: string[]): Promise<LeadSignals> {
  if (leadIds.length === 0) return { status: 'live', signals: new Map() };
  const results = await Promise.all(chunks(leadIds).map(ids =>
    q.from('client_lead_scores').select(SIGNAL_COLS).eq('session_id', sessionId).in('lead_id', ids),
  ));
  const failed = results.find(r => r.error || !r.data);
  if (failed) {
    if (failed.error?.code && MISSING_CODES.has(failed.error.code)) return { status: 'missing' };
    console.error('[command] client_lead_scores read failed:', failed.error?.code ?? '', failed.error?.message ?? 'no data');
    return { status: 'error' };
  }
  const signals = new Map<string, LeadSignal>();
  for (const r of results) for (const row of r.data!) signals.set(row.lead_id, row);
  return { status: 'live', signals };
}

/** The same read, in the shape mergeLiveScores takes. */
export function toLiveScores(s: LeadSignals): LiveScores {
  if (s.status !== 'live') return s;
  const scores = new Map<string, number | null>();
  for (const [id, row] of s.signals) scores.set(id, row.score);
  return { status: 'live', scores };
}

/** Newest outbound message time per lead. null when any read failed. */
export async function fetchLastOutbound(q: OutboundQuery, sessionId: string, leadIds: string[]): Promise<Map<string, string> | null> {
  if (leadIds.length === 0) return new Map();
  const results = await Promise.all(chunks(leadIds).map(ids =>
    q.from('lead_messages').select('lead_id, created_at')
      .eq('session_id', sessionId).eq('direction', 'outbound').in('lead_id', ids)
      .order('created_at', { ascending: false }).limit(OUTBOUND_ROW_CAP),
  ));
  const failed = results.find(r => r.error || !r.data);
  if (failed) {
    console.error('[command] lead_messages read failed:', failed.error?.code ?? '', failed.error?.message ?? 'no data');
    return null;
  }
  const newest = new Map<string, string>();
  for (const r of results) {
    for (const row of r.data!) {
      const seen = newest.get(row.lead_id);
      if (!seen || new Date(row.created_at).getTime() > new Date(seen).getTime()) newest.set(row.lead_id, row.created_at);
    }
  }
  return newest;
}

/** Cash recorded per lead (refunds are negative rows). null when any read failed. */
export async function fetchPaidByLead(q: PaymentQuery, sessionId: string, leadIds: string[]): Promise<Map<string, number> | null> {
  if (leadIds.length === 0) return new Map();
  const results = await Promise.all(chunks(leadIds).map(ids =>
    q.from('client_lead_payments').select('lead_id, amount_cents').eq('session_id', sessionId).in('lead_id', ids),
  ));
  const failed = results.find(r => r.error || !r.data);
  if (failed) {
    if (!(failed.error?.code && MISSING_CODES.has(failed.error.code))) {
      console.error('[command] client_lead_payments read failed:', failed.error?.code ?? '', failed.error?.message ?? 'no data');
    }
    return null;
  }
  const paid = new Map<string, number>();
  for (const r of results) {
    for (const row of r.data!) {
      const amount = Number(row.amount_cents);
      if (Number.isFinite(amount)) paid.set(row.lead_id, (paid.get(row.lead_id) ?? 0) + amount);
    }
  }
  return paid;
}
