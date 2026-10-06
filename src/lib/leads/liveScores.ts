import type { Lead } from '@/lib/metrics/leads';

/** The slice of a Supabase client this needs. Kept structural so the pages can
 *  pass the service client and tests can pass a stub. */
export type LiveScoreQuery = {
  from(table: 'client_lead_scores'): {
    select(cols: 'lead_id, score'): {
      eq(col: 'session_id', v: string): {
        limit(n: number): PromiseLike<{
          data: { lead_id: string; score: number | null }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

// Comfortably above the 500 leads a page loads, so every loaded lead finds its score.
const SCORE_ROWS = 2000;

/**
 * Read the LIVE score of every lead in a session from the client_lead_scores
 * view (migration 0020), which computes mate_lead_score(..., now()) at read
 * time. Freshness and reply recency decay with the clock, so the number has to
 * be read, never stored.
 *
 * Null when the view cannot be read (migration 0020 not applied yet, a
 * transient error): the caller then keeps the stored scores. Separate from the
 * merge so a page can run it inside its existing Promise.all.
 */
export async function fetchLiveScores(
  supabase: LiveScoreQuery, sessionId: string,
): Promise<Map<string, number> | null> {
  const { data, error } = await supabase
    .from('client_lead_scores')
    .select('lead_id, score')
    .eq('session_id', sessionId)
    .limit(SCORE_ROWS);
  if (error || !data) {
    console.warn('[liveScores] client_lead_scores unreadable, using stored scores:', error?.message ?? 'no data');
    return null;
  }
  const live = new Map<string, number>();
  for (const r of data) if (r.score != null) live.set(r.lead_id, r.score);
  return live;
}

/**
 * Replace each lead's stored `score` with its live one. A lead the view has no
 * row for keeps its stored score, and so does every lead when `live` is null.
 * The stored column is only populated for the seeded demo session, so the
 * fallback keeps the demo's card working before the migration lands and
 * changes nothing for a real client.
 */
export function mergeLiveScores(leads: Lead[], live: Map<string, number> | null): Lead[] {
  if (!live) return leads;
  return leads.map(l => (live.has(l.id) ? { ...l, score: live.get(l.id)! } : l));
}
