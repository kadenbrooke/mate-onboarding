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

/** Tiers 3 to 5 were never set by the First Responder; the client set them by
 *  hand in the 'Active Leads' tab of the lead sheet the Ranker reads. These are
 *  the distinct city -> tier pairs recovered from that tab's City and Tier
 *  columns on 2026-10-06 (nothing else was read). Every Tier 1 / Tier 2 city
 *  in the sheet is already in the lists above. Only Tier 3 moves the score
 *  (0.5); Tier 4 and 5 score like any other named city (0.4) and are listed
 *  so the mapping matches the sheet. 'coalville' is Tier 4 because the sheet
 *  says so. */
export const TIER3_CITIES = ['park city'] as const;
export const TIER4_CITIES = ['clearfield', 'clinton', 'coalville', 'ogden', 'roy', 'south weber'] as const;
export const TIER5_CITIES = ['beaverdam', 'corinne', 'logan', 'thatcher', 'tremonton'] as const;

/** Tier 7 / 8 / 8b are the sheet's tiers for a lead with NO city and no
 *  address, by phone area code: 7 = Wasatch Front (801, 385), 8 = 435,
 *  8b = out of state (anything else). In the sheet they appear only on rows
 *  with no city. */
export const WASATCH_FRONT_AREA_CODES = ['801', '385'] as const;
export const TIER8_AREA_CODE = '435';

/** '1' Utah County, '2' Salt Lake Valley, '3' Summit County, '4' Davis / Weber,
 *  '5' Box Elder / Cache, '7' / '8' / '8b' by area code (no city, no address). */
export type LeadTier = '1' | '2' | '3' | '4' | '5' | '7' | '8' | '8b';

const WS_EDGES = /^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g;

export function cityTier(city: string | null | undefined): LeadTier | null {
  const c = (city ?? '').toLowerCase().replace(WS_EDGES, '');
  const has = (list: readonly string[]) => list.includes(c);
  if (has(TIER1_CITIES)) return '1';
  if (has(TIER2_CITIES)) return '2';
  if (has(TIER3_CITIES)) return '3';
  if (has(TIER4_CITIES)) return '4';
  if (has(TIER5_CITIES)) return '5';
  return null;
}

/** Area-code tier from the last 10 digits of the phone. Null without a
 *  10-digit number. */
export function phoneTier(phone: string | null | undefined): '7' | '8' | '8b' | null {
  const digits = (phone ?? '').replace(/[^0-9]/g, '').slice(-10);
  if (digits.length < 10) return null;
  const area = digits.slice(0, 3);
  if ((WASATCH_FRONT_AREA_CODES as readonly string[]).includes(area)) return '7';
  if (area === TIER8_AREA_CODE) return '8';
  return '8b';
}

/** The lead's tier: by city when it gave one, by area code only when it gave
 *  neither a city nor an address (the sheet's rule). */
export function leadTier(
  city: string | null | undefined, address: string | null | undefined, phone: string | null | undefined,
): LeadTier | null {
  if (filled(city)) return cityTier(city);
  if (filled(address)) return null;
  return phoneTier(phone);
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

/** Proximity from the tier, as the Ranker scored it. Its test was a prefix
 *  match, so 'Tier 8b' scores like 'Tier 8'. Tiers 4, 5 and 7 carry no weight
 *  of their own and fall through to "has a city" / "has nothing". */
export function proximityFor(tier: LeadTier | null, city: string | null | undefined): number {
  if (tier === '1') return 1.0;
  if (tier === '2') return 0.7;
  if (tier === '3') return 0.5;
  if (tier === '8' || tier === '8b') return 0.1;
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
  const proximity = proximityFor(leadTier(i.city, i.address, i.phone), i.city);
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
