// ---------------------------------------------------------------------------
// Live lead score. The TypeScript twin of public.mate_lead_score() in
// supabase/migrations/0020_lead_live_score.sql.
//
// The SQL function is the one that ranks real leads (through the
// client_lead_scores view, computed at read time). This twin exists so the
// formula can be unit-tested without a database, and leadScore.sql.test.ts
// runs both against the same fixtures in a real Postgres (PGlite) so they can
// never drift. Change one, change the other.
//
// Founder-approved 2026-10-06: the July "JC Lead Ranker" n8n formula
// (workflow 8J6yuD5zxQIDDd0w, which only ever wrote a Google Sheet),
// reweighted to 80%, plus reply recency at 20%:
//
//   score = round(100 x (0.24 value + 0.20 urgency + 0.16 proximity
//                        + 0.12 freshness + 0.08 completeness + 0.20 reply))
//
// clamped 0-100. Freshness and reply decay with the clock, which is why the
// score is computed when it is read and never stored.
//
// Arithmetic is IEEE double on both sides in the same order, and rounding is
// floor(x + 0.5) on both sides (Math.round's definition), so the twins agree
// to the integer.
// ---------------------------------------------------------------------------

/** Ported verbatim from the First Responder's "Build Lead Summary" node
 *  (n8n workflow MyTAmqQsLDUtAyep, export 2026-09-30). The FR assigns these
 *  from the city the lead gives, lowercased and trimmed, exact match only. */
export const TIER1_CITIES = [
  'orem', 'provo', 'pleasant grove', 'lindon', 'american fork', 'lehi', 'springville',
  'spanish fork', 'payson', 'vineyard', 'saratoga springs', 'eagle mountain', 'highland',
  'alpine', 'cedar hills', 'mapleton', 'salem', 'santaquin', 'genola', 'elk ridge',
  'woodland hills',
] as const;
export const TIER2_CITIES = [
  'salt lake city', 'west jordan', 'south jordan', 'sandy', 'draper', 'riverton', 'bluffdale',
  'herriman', 'west valley city', 'west valley', 'murray', 'midvale', 'taylorsville', 'holladay',
  'cottonwood heights', 'millcreek', 'magna', 'kearns', 'south salt lake',
] as const;

/** Tier 1 = Utah County (around Orem), Tier 2 = Salt Lake Valley, null =
 *  anywhere else. The sheet also carried hand-set Tier 3 and Tier 8; nothing
 *  in Mate records those, so only 1 and 2 are ever derived here. */
export function cityTier(city: string | null | undefined): 1 | 2 | null {
  const c = (city ?? '').toLowerCase().replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');
  if ((TIER1_CITIES as readonly string[]).includes(c)) return 1;
  if ((TIER2_CITIES as readonly string[]).includes(c)) return 2;
  return null;
}

/** Non-blank after stripping ASCII whitespace. The SQL twin strips the same
 *  six characters with btrim(), so the two agree on what "filled" means. */
function filled(v: string | null | undefined): boolean {
  return v != null && /[^ \t\r\n\f\v]/.test(v);
}

/** Urgency from the free-text timeframe. The regexes and their ORDER are the
 *  Ranker's: "more than 2 weeks" is a 0.3 because the far-off check runs
 *  before the two-week one. */
export function urgencyFor(timeframe: string | null | undefined): number {
  const tf = (timeframe ?? '').toLowerCase();
  if (/asap|today|tomorrow|this week|right away|right now/.test(tf)) return 1.0;
  if (/more than|over a|later|someday|next year|spring|fall/.test(tf)) return 0.3;
  if (/next week|1 week|a week|in the next week/.test(tf)) return 0.9;
  if (/2 week|two week|couple week/.test(tf)) return 0.85;
  if (/30 day|month|3 week|few week/.test(tf)) return 0.6;
  return 0.4;
}

/** Proximity from the tier. Tier 3 and Tier 8 are kept for fidelity with the
 *  Ranker even though cityTier() never produces them. */
export function proximityFor(tier: number | null, city: string | null | undefined): number {
  if (tier === 1) return 1.0;
  if (tier === 2) return 0.7;
  if (tier === 3) return 0.5;
  if (tier === 8) return 0.1;
  return filled(city) ? 0.4 : 0.3;
}

const DAY_MS = 86400000;

function ageDays(at: string, now: Date): number {
  return (now.getTime() - new Date(at).getTime()) / DAY_MS;
}

export function freshnessFor(createdAt: string, now: Date): number {
  const d = ageDays(createdAt, now);
  return d <= 2 ? 1.0 : d <= 7 ? 0.7 : d <= 14 ? 0.4 : 0.2;
}

/** How recently the LEAD (not the agent) last texted. Never replied = 0. */
export function replyFor(lastLeadReplyAt: string | null | undefined, now: Date): number {
  if (!lastLeadReplyAt) return 0;
  const d = ageDays(lastLeadReplyAt, now);
  return d <= 1 ? 1.0 : d <= 3 ? 0.8 : d <= 7 ? 0.6 : d <= 14 ? 0.4 : 0.2;
}

/** Quote value. No quote (or a non-positive one) is a neutral 0.3, same as
 *  the Ranker's blank cell; $25,000 and up is the ceiling. */
export function valueFor(quoteCents: number | null | undefined): number {
  if (quoteCents == null || quoteCents <= 0) return 0.3;
  return Math.min(quoteCents / 100 / 25000, 1);
}

export type LeadScoreInputs = {
  quote_cents: number | null;
  timeframe: string | null;
  city: string | null;
  name: string | null;
  phone: string | null;
  address: string | null;
  dimensions: string | null;
  /** client_leads.created_at */
  created_at: string;
  /** max(lead_messages.created_at) where direction='inbound' and author='lead' */
  last_lead_reply_at: string | null;
};

export function leadScore(i: LeadScoreInputs, now: Date): number {
  const value = valueFor(i.quote_cents);
  const urgency = urgencyFor(i.timeframe);
  const proximity = proximityFor(cityTier(i.city), i.city);
  const freshness = freshnessFor(i.created_at, now);
  const completeness =
    [i.name, i.phone, i.address, i.city, i.timeframe, i.dimensions].filter(filled).length / 6;
  const reply = replyFor(i.last_lead_reply_at, now);
  const raw = 100 * (
    0.24 * value + 0.20 * urgency + 0.16 * proximity
    + 0.12 * freshness + 0.08 * completeness + 0.20 * reply
  );
  return Math.max(0, Math.min(100, Math.floor(raw + 0.5)));
}
