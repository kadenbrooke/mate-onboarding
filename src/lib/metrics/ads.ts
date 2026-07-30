// src/lib/metrics/ads.ts
//
// Meta (Facebook) Marketing API Insights -> ad_metrics mapping + dashboard math.
//
// Two concerns live here, both pure so they unit-test without a network:
//   1. mapInsightsToRows  -- Insights API payload -> DB-shaped rows (spend/leads/CPL)
//   2. adTotals           -- ad_metrics rows -> headline zone stats (total spend,
//                            total leads, blended cost-per-lead, per-campaign)
//
// Money is stored in whole cents (spend_cents, cpl_cents) to match every other
// metric in this app (quote_cents, won_cents, ...). Meta returns dollars as
// strings ("605.23"); we round to cents on the way in.

/** A single campaign row from the Meta Insights response (level=campaign). */
export type MetaInsightAction = { action_type: string; value: string };
export type MetaInsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpc?: string;
  ctr?: string;
  actions?: MetaInsightAction[];
  cost_per_action_type?: MetaInsightAction[];
  date_start?: string;
  date_stop?: string;
};
export type MetaInsightsResponse = { data?: MetaInsightRow[] };

/**
 * Action types that represent a captured lead, in priority order. Meta reports
 * the same lead count under several synonymous keys; `lead_grouped` is the
 * canonical grouped lead metric, `leadgen_grouped` is the older name, `lead`
 * is the ungrouped fallback. We take the first one present.
 */
const LEAD_ACTION_TYPES = [
  'onsite_conversion.lead_grouped',
  'leadgen_grouped',
  'lead',
] as const;

/** Row shape written to the `ad_metrics` table (one row per campaign per pull). */
export type AdMetricRow = {
  session_id: string;
  campaign_id: string;
  campaign_name: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl_cents: number; // cost per lead, whole cents; 0 when no leads
  date_pulled: string; // YYYY-MM-DD (UTC day of the pull)
  raw: MetaInsightRow; // full campaign object, for audit / future fields
};

function actionValue(actions: MetaInsightAction[] | undefined, types: readonly string[]): number {
  if (!actions) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) {
      const n = Number(hit.value);
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  return 0;
}

function dollarsToCents(dollars: string | undefined): number {
  const n = Number(dollars ?? '0');
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function toInt(v: string | undefined): number {
  const n = Number(v ?? '0');
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Map a Meta Insights response into DB rows. `datePulled` is passed in (not read
 * from the system clock) so the caller controls the UTC day key and tests stay
 * deterministic. Rows missing a campaign_id are skipped (nothing to key on).
 */
export function mapInsightsToRows(
  resp: MetaInsightsResponse,
  sessionId: string,
  datePulled: string,
): AdMetricRow[] {
  const rows = resp.data ?? [];
  const out: AdMetricRow[] = [];
  for (const r of rows) {
    if (!r.campaign_id) continue;
    const spend_cents = dollarsToCents(r.spend);
    const leads = actionValue(r.actions, LEAD_ACTION_TYPES);
    // Blended CPL from our own spend/leads, not Meta's cost_per_action_type:
    // one source of truth means spend and leads always reconcile to the CPL
    // shown. Guard divide-by-zero (a running campaign with no leads yet).
    const cpl_cents = leads > 0 ? Math.round(spend_cents / leads) : 0;
    out.push({
      session_id: sessionId,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name ?? 'Campaign',
      spend_cents,
      impressions: toInt(r.impressions),
      clicks: toInt(r.clicks),
      leads,
      cpl_cents,
      date_pulled: datePulled,
      raw: r,
    });
  }
  return out;
}

/** Per-campaign summary consumed by the zone UI. */
export type AdCampaignStat = {
  campaign_id: string;
  campaign_name: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl_cents: number;
};

/** Headline stats for the Ad Performance zone. */
export type AdTotals = {
  spend_cents: number;
  leads: number;
  cpl_cents: number; // blended: total spend / total leads
  impressions: number;
  clicks: number;
  campaigns: AdCampaignStat[];
  date_pulled: string | null; // most recent pull represented, null if empty
};

/**
 * Collapse the latest ad_metrics rows into zone totals. Callers pass the most
 * recent snapshot (one row per campaign) already filtered to a single
 * date_pulled; this only sums and computes the blended CPL. Blended CPL uses
 * grand totals (not an average of per-campaign CPLs) so it equals what the
 * client would get dividing their total spend by their total leads.
 */
export function adTotals(rows: AdMetricRow[]): AdTotals {
  const campaigns: AdCampaignStat[] = rows.map((r) => ({
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    spend_cents: r.spend_cents,
    impressions: r.impressions,
    clicks: r.clicks,
    leads: r.leads,
    cpl_cents: r.cpl_cents,
  }));
  const spend_cents = rows.reduce((a, r) => a + r.spend_cents, 0);
  const leads = rows.reduce((a, r) => a + r.leads, 0);
  const impressions = rows.reduce((a, r) => a + r.impressions, 0);
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  const cpl_cents = leads > 0 ? Math.round(spend_cents / leads) : 0;
  const date_pulled = rows.length ? rows[0].date_pulled : null;
  return { spend_cents, leads, cpl_cents, impressions, clicks, campaigns, date_pulled };
}
