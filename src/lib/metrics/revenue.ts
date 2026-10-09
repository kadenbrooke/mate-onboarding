// src/lib/metrics/revenue.ts
//
// Return per lead source, and the partner revenue-share basis.
//
// Inputs are the job outcomes the client enters per lead (migration 0021:
// job_outcome, job_value_cents on client_leads) and the cash ledger
// (client_lead_payments: one row per payment, negative for a refund). Every
// cash window sums only the payments dated inside it; a lead has no stored
// running total to go stale. Two ways in:
//   * the client_lead_revenue_by_source view (0021), which sums the WHOLE book
//     of business per source in a few PII-free rows. /dash and the assistant
//     read this.
//   * revenueRowsFromLeads(), the TypeScript twin of that view over loaded
//     leads and payments. revenue.sql.test.ts holds the two to the same
//     numbers in a real Postgres.
// Both produce SourceRevenueRow[]; summarizeReturn() turns either into the card.
//
// The 15% figure is an ESTIMATE. Every source counts toward the partner basis;
// the sole exception is self_sourced work that never received an AI-agent
// message. The prior-12-month customer exclusion is not computed because Mate
// has no record of the client's prior customers. Which source is eligible is
// decided in partnerChannels.ts and the message condition is supplied by the
// SQL view (0023).

import type { Lead } from './leads';
import type { AdMetricRow } from './ads';
import {
  channelOwner, partnerShareCents, PARTNER_SHARE_BPS, PARTNER_WINDOW_MONTHS, type ChannelOwner,
} from './partnerChannels';

/** One row of client_lead_revenue_by_source, minus the tenant id. */
export type SourceRevenueRow = {
  source: string;
  leads: number;
  won: number;
  lost: number;
  job_value_cents: number;
  collected_cents: number;
  /** Cash collected within PARTNER_WINDOW_MONTHS of the lead's first contact. */
  collected_in_window_cents: number;
  /** Payments dated in the last 30 days. */
  collected_30d_cents: number;
  /** For self_sourced rows, only cash from leads the AI agent messaged. */
  partner_collected_in_window_cents?: number;
};

const DAY_MS = 86_400_000;

/**
 * `ts + n months` the way Postgres adds an interval of months to a timestamptz
 * in a UTC session: same day of month, clamped to the target month's last day,
 * time of day kept.
 */
export function addMonthsUtc(ts: Date, months: number): Date {
  const y = ts.getUTCFullYear();
  const m = ts.getUTCMonth() + months;
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const day = Math.min(ts.getUTCDate(), lastDay);
  return new Date(Date.UTC(
    targetY, targetM, day,
    ts.getUTCHours(), ts.getUTCMinutes(), ts.getUTCSeconds(), ts.getUTCMilliseconds(),
  ));
}

const cents = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** One client_lead_payments row, as far as the math needs it. */
export type LeadPayment = { lead_id: string; amount_cents: number; paid_at: string };

/**
 * The TypeScript twin of client_lead_revenue_by_source for one tenant's leads
 * and their payments. Callers pass leads already filtered to the tenant and to
 * is_test = false (every lead query in the app does both). Payments for leads
 * not in `leads` are ignored, as the view's join ignores them. Rows come back
 * in first-seen order.
 */
export function revenueRowsFromLeads(
  leads: Lead[], payments: LeadPayment[] = [], now = new Date(),
): SourceRevenueRow[] {
  const bySource = new Map<string, SourceRevenueRow>();
  const since30d = now.getTime() - 30 * DAY_MS;
  const paymentsByLead = new Map<string, LeadPayment[]>();
  for (const p of payments) {
    const list = paymentsByLead.get(p.lead_id);
    if (list) list.push(p); else paymentsByLead.set(p.lead_id, [p]);
  }
  for (const l of leads) {
    let row = bySource.get(l.source);
    if (!row) {
      row = {
        source: l.source, leads: 0, won: 0, lost: 0, job_value_cents: 0,
        collected_cents: 0, collected_in_window_cents: 0, collected_30d_cents: 0,
      };
      if (l.source === 'self_sourced') row.partner_collected_in_window_cents = 0;
      bySource.set(l.source, row);
    }
    row.leads += 1;
    if (l.job_outcome === 'lost') row.lost += 1;
    if (l.job_outcome === 'won') {
      row.won += 1;
      row.job_value_cents += cents(l.job_value_cents);
    }
    // Each payment lands in a window by its OWN date. The DB only lets
    // payments onto a won lead, so no outcome check here.
    const windowEnd = addMonthsUtc(new Date(l.created_at), PARTNER_WINDOW_MONTHS).getTime();
    for (const p of paymentsByLead.get(l.id) ?? []) {
      const amount = cents(p.amount_cents);
      const at = new Date(p.paid_at).getTime();
      row.collected_cents += amount;
      if (at < windowEnd) row.collected_in_window_cents += amount;
      if (at < windowEnd && (l.source !== 'self_sourced' || l.agent_message_sent === true)) {
        if (row.partner_collected_in_window_cents !== undefined) row.partner_collected_in_window_cents += amount;
      }
      if (at >= since30d) row.collected_30d_cents += amount;
    }
  }
  return [...bySource.values()];
}

/**
 * Meta spend over the last 30 days. ad_metrics rows are ROLLING last-30-day
 * snapshots per campaign (date_preset=last_30d), so summing them across days
 * would count the same spend up to 30 times. Instead: each campaign's newest
 * snapshot, counted only if it came from the newest Meta pull. A campaign
 * missing from that pull had no delivery in its window (Meta's campaign-level
 * insights omit campaigns with no data), so its older snapshot describes a
 * window that has already rolled past. null when there are no Meta rows.
 */
export function metaSpend30dCents(rows: Pick<AdMetricRow, 'platform' | 'campaign_id' | 'spend_cents' | 'date_pulled'>[]): number | null {
  const meta = rows.filter(r => r.platform === 'meta');
  if (meta.length === 0) return null;
  const newestPull = meta.reduce((d, r) => (r.date_pulled > d ? r.date_pulled : d), meta[0].date_pulled);
  const latestPerCampaign = new Map<string, (typeof meta)[number]>();
  for (const r of meta) {
    const seen = latestPerCampaign.get(r.campaign_id);
    if (!seen || r.date_pulled > seen.date_pulled) latestPerCampaign.set(r.campaign_id, r);
  }
  let total = 0;
  for (const r of latestPerCampaign.values()) {
    if (r.date_pulled === newestPull) total += cents(r.spend_cents);
  }
  return total;
}

export type SourceReturn = SourceRevenueRow & {
  owner: ChannelOwner;
  /** Won as a share of every lead from the source, 0-100, rounded. null with
   *  no leads. Leads with no outcome entered count as not won. */
  winRate: number | null;
};

export type ReturnSummary = {
  rows: SourceReturn[];
  totals: { leads: number; won: number; lost: number; jobValueCents: number; collectedCents: number };
  /** True once any lead has a won or lost entered. */
  hasOutcomes: boolean;
  partner: {
    /** Cash from partner-channel sources inside the 24-month window. */
    collectedCents: number;
    shareBps: number;
    shareCents: number;
    sources: string[];
  };
  meta: {
    spend30dCents: number | null;
    collected30dCents: number;
    collectedCents: number;
    /** collected30d / spend30d, e.g. 3.2 means $3.20 back per $1. null without spend. */
    returnPerDollar: number | null;
  };
};

/** Turn per-source rows (from the view or the twin) into the card's numbers. */
export function summarizeReturn(
  input: SourceRevenueRow[], opts: { metaSpend30dCents?: number | null } = {},
): ReturnSummary {
  const rows: SourceReturn[] = input.map(r => ({
    ...r,
    leads: Number(r.leads), won: Number(r.won), lost: Number(r.lost),
    job_value_cents: Number(r.job_value_cents),
    collected_cents: Number(r.collected_cents),
    collected_in_window_cents: Number(r.collected_in_window_cents),
    collected_30d_cents: Number(r.collected_30d_cents),
    ...(r.partner_collected_in_window_cents !== undefined
      ? { partner_collected_in_window_cents: Number(r.partner_collected_in_window_cents) }
      : {}),
    owner: channelOwner(r.source),
    winRate: Number(r.leads) > 0 ? Math.round((Number(r.won) / Number(r.leads)) * 100) : null,
  })).sort((a, b) => b.collected_cents - a.collected_cents || b.won - a.won || b.leads - a.leads
    || a.source.localeCompare(b.source));

  const sum = (f: (r: SourceReturn) => number, rs = rows) => rs.reduce((t, r) => t + f(r), 0);
  const partnerRows = rows.filter(r => r.owner === 'partner');
  const partnerCollected = sum(r => r.source === 'self_sourced'
    ? (r.partner_collected_in_window_cents ?? 0)
    : r.collected_in_window_cents, partnerRows);
  const metaRows = rows.filter(r => r.source === 'meta');
  const spend = opts.metaSpend30dCents ?? null;
  const metaCollected30d = sum(r => r.collected_30d_cents, metaRows);

  return {
    rows,
    totals: {
      leads: sum(r => r.leads), won: sum(r => r.won), lost: sum(r => r.lost),
      jobValueCents: sum(r => r.job_value_cents), collectedCents: sum(r => r.collected_cents),
    },
    hasOutcomes: rows.some(r => r.won > 0 || r.lost > 0),
    partner: {
      collectedCents: partnerCollected,
      shareBps: PARTNER_SHARE_BPS,
      shareCents: partnerShareCents(partnerCollected),
      sources: partnerRows.map(r => r.source),
    },
    meta: {
      spend30dCents: spend,
      collected30dCents: metaCollected30d,
      collectedCents: sum(r => r.collected_cents, metaRows),
      returnPerDollar: spend && spend > 0 ? Math.round((metaCollected30d / spend) * 10) / 10 : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Reading the view
// ---------------------------------------------------------------------------

type QueryError = { message: string; code?: string };

const REVENUE_COLS =
  'source, leads, won, lost, job_value_cents, collected_cents, collected_in_window_cents, collected_30d_cents, partner_collected_in_window_cents' as const;

/** The slice of a Supabase client this needs (structural, so tests can stub it). */
export type RevenueQuery = {
  from(table: 'client_lead_revenue_by_source'): {
    select(cols: typeof REVENUE_COLS): {
      eq(col: 'session_id', v: string): PromiseLike<{ data: SourceRevenueRow[] | null; error: QueryError | null }>;
    };
  };
};

// The view does not exist yet (migration 0021 not applied).
const MISSING_VIEW_CODES = new Set(['PGRST205', '42P01']);

/** Per-source rows for one tenant; null when the view is missing or the read
 *  failed (logged), which hides the card rather than showing zeros as fact. */
export async function fetchRevenueBySource(
  supabase: RevenueQuery, sessionId: string,
): Promise<SourceRevenueRow[] | null> {
  const { data, error } = await supabase
    .from('client_lead_revenue_by_source').select(REVENUE_COLS).eq('session_id', sessionId);
  if (error || !data) {
    if (!(error?.code && MISSING_VIEW_CODES.has(error.code))) {
      console.error('[revenue] client_lead_revenue_by_source read failed:', error?.code ?? '', error?.message ?? 'no data');
    }
    return null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Reading Meta spend
// ---------------------------------------------------------------------------

type AdSpendRow = Pick<AdMetricRow, 'platform' | 'campaign_id' | 'spend_cents' | 'date_pulled'>;

/** The slice of a Supabase client this needs (structural, so tests can stub it). */
export type AdSpendQuery = {
  from(table: 'ad_metrics'): {
    select(cols: 'date_pulled' | 'platform, campaign_id, spend_cents, date_pulled'): {
      eq(col: 'session_id', v: string): {
        eq(col: 'platform', v: 'meta'): {
          order(col: 'date_pulled', o: { ascending: false }): {
            limit(n: 1): PromiseLike<{ data: { date_pulled: string }[] | null; error: QueryError | null }>;
          };
          eq(col: 'date_pulled', v: string): PromiseLike<{ data: AdSpendRow[] | null; error: QueryError | null }>;
        };
      };
    };
  };
};

/**
 * Meta's 30-day spend for one tenant, read without the dashboard's 100-row
 * cap: find the newest Meta pull date, then read every campaign row from that
 * pull (one row per campaign, per the (session, platform, campaign, day)
 * unique index). Same answer as metaSpend30dCents over the full history. null
 * when there is no Meta data or a read failed (logged).
 */
export async function fetchMetaSpend30dCents(supabase: AdSpendQuery, sessionId: string): Promise<number | null> {
  const newest = await supabase.from('ad_metrics').select('date_pulled')
    .eq('session_id', sessionId).eq('platform', 'meta')
    .order('date_pulled', { ascending: false }).limit(1);
  if (newest.error) {
    console.error('[revenue] ad_metrics newest Meta pull read failed:', newest.error.code ?? '', newest.error.message);
    return null;
  }
  const day = newest.data?.[0]?.date_pulled;
  if (!day) return null;
  const pull = await supabase.from('ad_metrics').select('platform, campaign_id, spend_cents, date_pulled')
    .eq('session_id', sessionId).eq('platform', 'meta').eq('date_pulled', day);
  if (pull.error || !pull.data) {
    console.error('[revenue] ad_metrics Meta pull read failed:', pull.error?.code ?? '', pull.error?.message ?? 'no data');
    return null;
  }
  return metaSpend30dCents(pull.data);
}
