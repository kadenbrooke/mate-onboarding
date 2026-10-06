import type { Lead } from '@/lib/metrics/leads';

type ScoreRow = { lead_id: string; score: number | null };
type QueryError = { message: string; code?: string };

/** The slice of a Supabase client this needs. Kept structural so the pages can
 *  pass the service client and tests can pass a stub. */
export type LiveScoreQuery = {
  from(table: 'client_lead_scores'): {
    select(cols: 'lead_id, score'): {
      eq(col: 'session_id', v: string): {
        in(col: 'lead_id', ids: string[]): PromiseLike<{ data: ScoreRow[] | null; error: QueryError | null }>;
      };
    };
  };
};

/**
 *   live     -- the view answered; `scores` has an entry for every lead it knows
 *   missing  -- the view does not exist yet (migration 0020 not applied)
 *   error    -- any other failure; already logged
 */
export type LiveScores =
  | { status: 'live'; scores: Map<string, number | null> }
  | { status: 'missing' }
  | { status: 'error' };

// Ids per request. 100 uuids keep the PostgREST URL around 4 KB.
export const SCORE_CHUNK = 100;

// "relation does not exist" from Postgres, and PostgREST's "not in the schema
// cache". The only errors that mean the view simply is not there yet.
const MISSING_VIEW_CODES = new Set(['PGRST205', '42P01']);

/**
 * Read the LIVE score of exactly these leads from the client_lead_scores view
 * (migration 0020), which computes mate_lead_score(..., now()) at read time.
 * Freshness and reply recency decay with the clock, so the number has to be
 * read, never stored. Scoped to the tenant AND to the ids the page loaded, in
 * chunks, so no displayed lead can fall outside the read.
 */
export async function fetchLiveScores(
  supabase: LiveScoreQuery, sessionId: string, leadIds: string[],
): Promise<LiveScores> {
  if (leadIds.length === 0) return { status: 'live', scores: new Map() };
  const chunks: string[][] = [];
  for (let i = 0; i < leadIds.length; i += SCORE_CHUNK) chunks.push(leadIds.slice(i, i + SCORE_CHUNK));
  const results = await Promise.all(chunks.map(ids =>
    supabase.from('client_lead_scores').select('lead_id, score').eq('session_id', sessionId).in('lead_id', ids),
  ));
  const failed = results.find(r => r.error || !r.data);
  if (failed) {
    if (failed.error?.code && MISSING_VIEW_CODES.has(failed.error.code)) return { status: 'missing' };
    console.error('[liveScores] client_lead_scores read failed:', failed.error?.code ?? '', failed.error?.message ?? 'no data');
    return { status: 'error' };
  }
  const scores = new Map<string, number | null>();
  for (const r of results) for (const row of r.data!) scores.set(row.lead_id, row.score);
  return { status: 'live', scores };
}

/**
 * Put the live score on each lead.
 *   live     -- the live score; a lead the view has no row for gets null
 *   missing  -- the stored score, untouched. Only the seeded demo session has
 *               stored scores, so this keeps its card working until 0020 lands
 *               and changes nothing for a real client.
 *   error    -- null for every lead: an outage reads as "not scored", never as
 *               a stale stored number.
 */
export function mergeLiveScores(leads: Lead[], live: LiveScores): Lead[] {
  if (live.status === 'missing') return leads;
  if (live.status === 'error') return leads.map(l => ({ ...l, score: null }));
  return leads.map(l => ({ ...l, score: live.scores.get(l.id) ?? null }));
}
