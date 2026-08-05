// src/lib/metrics/ads.ts
//
// Paid-ads mapping + dashboard math for BOTH platforms on one card.
//
// Meta and Google share a single Ad Performance zone (founder call: one card,
// not one per platform). Everything here is pure so it unit-tests without a
// network:
//   1. mapInsightsToRows   -- Meta Insights payload   -> DB rows
//   2. mapGoogleRowsToRows -- Google Ads GAQL payload -> DB rows
//   3. adTotals            -- ad_metrics rows -> zone stats, blended across
//                             platforms AND split per platform
//
// Money is stored in whole cents (spend_cents, cpl_cents) to match every other
// metric in this app (quote_cents, won_cents, ...). Meta returns dollars as
// strings ("605.23"); Google returns micros ("680530000"). Both land in cents.

/** Ad platforms the refresh route knows how to pull. Mirrors the DB check
 *  constraint on ad_metrics.platform (migration 0007). */
export type AdPlatform = 'meta' | 'google';

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

/** A single campaign row from a Google Ads GAQL response (searchStream).
 *  Google returns integer-ish metrics as strings and conversions as a float. */
export type GoogleAdsRow = {
  campaign?: { id?: string; name?: string };
  metrics?: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: string | number;
  };
};
export type GoogleAdsResponse = { results?: GoogleAdsRow[] };

/** Row shape written to the `ad_metrics` table (one row per campaign per pull). */
export type AdMetricRow = {
  session_id: string;
  platform: AdPlatform;
  campaign_id: string;
  campaign_name: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl_cents: number; // cost per lead, whole cents; 0 when no leads
  date_pulled: string; // YYYY-MM-DD (UTC day of the pull)
  raw: MetaInsightRow | GoogleAdsRow; // full campaign object, for audit
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
      platform: 'meta',
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

/** Google reports spend in micros (1,000,000 micros = 1 unit of currency), so
 *  cents = micros / 10,000. Kept explicit because getting this wrong by 10^2 is
 *  the classic Google Ads bug and it fails silently as a plausible number. */
function microsToCents(micros: string | number | undefined): number {
  const n = Number(micros ?? 0);
  return Number.isFinite(n) ? Math.round(n / 10000) : 0;
}

function numeric(v: string | number | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Map a Google Ads GAQL response into DB rows. Mirrors mapInsightsToRows: same
 * output shape, same caller-supplied datePulled, same skip-if-no-id rule, so
 * both platforms upsert through one code path.
 *
 * `conversions` is Google's lead signal. It is a FLOAT (fractional conversions
 * are real -- Google attributes partial credit), so it rounds to a whole lead
 * count for display. A campaign with 0.4 conversions rounds to 0, which is
 * correct: we do not want to claim a lead the client cannot point at.
 */
export function mapGoogleRowsToRows(
  resp: GoogleAdsResponse,
  sessionId: string,
  datePulled: string,
): AdMetricRow[] {
  const rows = resp.results ?? [];
  const out: AdMetricRow[] = [];
  for (const r of rows) {
    const id = r.campaign?.id;
    if (!id) continue;
    const spend_cents = microsToCents(r.metrics?.costMicros);
    const leads = numeric(r.metrics?.conversions);
    const cpl_cents = leads > 0 ? Math.round(spend_cents / leads) : 0;
    out.push({
      session_id: sessionId,
      platform: 'google',
      campaign_id: String(id),
      campaign_name: r.campaign?.name ?? 'Campaign',
      spend_cents,
      impressions: numeric(r.metrics?.impressions),
      clicks: numeric(r.metrics?.clicks),
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
  platform: AdPlatform;
  campaign_id: string;
  campaign_name: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl_cents: number;
};

/** One platform's roll-up. The zone rings by platform when more than one is
 *  live, so the client sees at a glance where the money goes and which channel
 *  buys leads cheaper. */
export type AdPlatformStat = {
  platform: AdPlatform;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl_cents: number; // blended within the platform
  campaigns: AdCampaignStat[];
  date_pulled: string | null;
};

/** Headline stats for the Ad Performance zone. */
export type AdTotals = {
  spend_cents: number;
  leads: number;
  cpl_cents: number; // blended across ALL platforms: total spend / total leads
  impressions: number;
  clicks: number;
  campaigns: AdCampaignStat[];
  platforms: AdPlatformStat[]; // ordered by spend desc
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
    platform: r.platform,
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

  // Per-platform roll-up. Each platform keeps its own date_pulled because Meta
  // and Google refresh independently and can legitimately be a day apart; the
  // card's footer shows the OLDEST of them so it never overstates freshness.
  const byPlatform = new Map<AdPlatform, AdCampaignStat[]>();
  for (const c of campaigns) {
    const list = byPlatform.get(c.platform);
    if (list) list.push(c);
    else byPlatform.set(c.platform, [c]);
  }
  const platforms: AdPlatformStat[] = [...byPlatform.entries()]
    .map(([platform, list]) => {
      const pSpend = list.reduce((a, c) => a + c.spend_cents, 0);
      const pLeads = list.reduce((a, c) => a + c.leads, 0);
      const dates = rows.filter((r) => r.platform === platform).map((r) => r.date_pulled).sort();
      return {
        platform,
        spend_cents: pSpend,
        impressions: list.reduce((a, c) => a + c.impressions, 0),
        clicks: list.reduce((a, c) => a + c.clicks, 0),
        leads: pLeads,
        cpl_cents: pLeads > 0 ? Math.round(pSpend / pLeads) : 0,
        campaigns: list,
        date_pulled: dates.length ? dates[dates.length - 1] : null,
      };
    })
    .sort((a, b) => b.spend_cents - a.spend_cents);

  // Oldest pull across platforms -- an honest "as of" for the whole card.
  const allDates = rows.map((r) => r.date_pulled).sort();
  const date_pulled = allDates.length ? allDates[0] : null;

  return { spend_cents, leads, cpl_cents, impressions, clicks, campaigns, platforms, date_pulled };
}
