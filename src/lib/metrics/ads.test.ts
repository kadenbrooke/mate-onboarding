import { describe, it, expect } from 'vitest';
import {
  mapInsightsToRows,
  mapGoogleRowsToRows,
  adTotals,
  type MetaInsightsResponse,
  type MetaInsightRow,
  type GoogleAdsResponse,
  type AdMetricRow,
} from './ads';

// Captured live from J&C's ad account act_780930229191886 (level=campaign,
// last_30d) on 2026-07-29. Trimmed to the fields we consume plus a
// representative slice of the actions array (real payload has ~23 action types).
const REAL_PAYLOAD: MetaInsightsResponse = {
  data: [
    {
      campaign_id: '120246899643110407',
      campaign_name: 'New J&C Leads Campaign',
      spend: '605.23',
      impressions: '31546',
      clicks: '439',
      cpc: '1.378656',
      ctr: '1.391619',
      actions: [
        { action_type: 'link_click', value: '313' },
        { action_type: 'post_engagement', value: '856' },
        { action_type: 'lead', value: '22' },
        { action_type: 'onsite_conversion.lead_grouped', value: '22' },
        { action_type: 'video_view', value: '499' },
      ],
      cost_per_action_type: [
        { action_type: 'onsite_conversion.lead_grouped', value: '27.510455' },
      ],
      date_start: '2026-06-29',
      date_stop: '2026-07-28',
    },
  ],
};

describe('mapInsightsToRows', () => {
  it('maps the real J&C payload to a single ad_metrics row', () => {
    const rows = mapInsightsToRows(REAL_PAYLOAD, 'sess-1', '2026-07-29');
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.session_id).toBe('sess-1');
    expect(r.campaign_id).toBe('120246899643110407');
    expect(r.campaign_name).toBe('New J&C Leads Campaign');
    expect(r.spend_cents).toBe(60523); // $605.23
    expect(r.impressions).toBe(31546);
    expect(r.clicks).toBe(439);
    expect(r.leads).toBe(22);
    expect(r.date_pulled).toBe('2026-07-29');
  });

  it('computes CPL as spend/leads in cents ($605.23 / 22 = $27.51)', () => {
    const [r] = mapInsightsToRows(REAL_PAYLOAD, 'sess-1', '2026-07-29');
    expect(r.cpl_cents).toBe(2751); // round(60523 / 22) = 2751 cents = $27.51
  });

  it('preserves the full campaign object in raw for audit', () => {
    const [r] = mapInsightsToRows(REAL_PAYLOAD, 'sess-1', '2026-07-29');
    // raw is a union (Meta | Google) now that both platforms share the row
    // shape; narrow to the Meta side for this Meta-only assertion.
    expect((r.raw as MetaInsightRow).cpc).toBe('1.378656');
  });

  it('prefers lead_grouped, falls back to leadgen_grouped then lead', () => {
    const grouped: MetaInsightsResponse = {
      data: [{
        campaign_id: 'c1', spend: '100.00',
        actions: [
          { action_type: 'lead', value: '9' },
          { action_type: 'leadgen_grouped', value: '5' },
        ],
      }],
    };
    // no lead_grouped present -> leadgen_grouped wins over bare lead
    expect(mapInsightsToRows(grouped, 's', '2026-07-29')[0].leads).toBe(5);

    const bareOnly: MetaInsightsResponse = {
      data: [{ campaign_id: 'c1', spend: '100.00', actions: [{ action_type: 'lead', value: '9' }] }],
    };
    expect(mapInsightsToRows(bareOnly, 's', '2026-07-29')[0].leads).toBe(9);
  });

  it('handles a running campaign with spend but zero leads (no divide-by-zero)', () => {
    const noLeads: MetaInsightsResponse = {
      data: [{ campaign_id: 'c1', spend: '40.00', actions: [{ action_type: 'link_click', value: '3' }] }],
    };
    const [r] = mapInsightsToRows(noLeads, 's', '2026-07-29');
    expect(r.leads).toBe(0);
    expect(r.cpl_cents).toBe(0);
    expect(r.spend_cents).toBe(4000);
  });

  it('skips rows with no campaign_id and tolerates an empty payload', () => {
    expect(mapInsightsToRows({ data: [{ spend: '10' }] }, 's', '2026-07-29')).toHaveLength(0);
    expect(mapInsightsToRows({}, 's', '2026-07-29')).toHaveLength(0);
    expect(mapInsightsToRows({ data: [] }, 's', '2026-07-29')).toHaveLength(0);
  });

  it('rounds fractional dollars to whole cents', () => {
    const frac: MetaInsightsResponse = {
      data: [{ campaign_id: 'c1', spend: '12.345', actions: [{ action_type: 'lead', value: '2' }] }],
    };
    const [r] = mapInsightsToRows(frac, 's', '2026-07-29');
    expect(r.spend_cents).toBe(1235); // round(12.345 * 100)
    expect(r.cpl_cents).toBe(618); // round(1235 / 2)
  });
});

describe('adTotals', () => {
  const rowsFor = (): AdMetricRow[] => mapInsightsToRows(REAL_PAYLOAD, 'sess-1', '2026-07-29');

  it('reports the single-campaign totals for J&C', () => {
    const t = adTotals(rowsFor());
    expect(t.spend_cents).toBe(60523);
    expect(t.leads).toBe(22);
    expect(t.cpl_cents).toBe(2751);
    expect(t.impressions).toBe(31546);
    expect(t.clicks).toBe(439);
    expect(t.campaigns).toHaveLength(1);
    expect(t.date_pulled).toBe('2026-07-29');
  });

  it('blends CPL across multiple campaigns using grand totals', () => {
    const rows: AdMetricRow[] = [
      { session_id: 's', platform: 'meta', campaign_id: 'a', campaign_name: 'A', spend_cents: 10000, impressions: 100, clicks: 10, leads: 4, cpl_cents: 2500, date_pulled: '2026-07-29', raw: {} },
      { session_id: 's', platform: 'meta', campaign_id: 'b', campaign_name: 'B', spend_cents: 6000, impressions: 60, clicks: 6, leads: 1, cpl_cents: 6000, date_pulled: '2026-07-29', raw: {} },
    ];
    const t = adTotals(rows);
    expect(t.spend_cents).toBe(16000);
    expect(t.leads).toBe(5);
    // blended = 16000 / 5 = 3200, NOT the average of 2500 and 6000 (4250)
    expect(t.cpl_cents).toBe(3200);
  });

  it('returns zeroed totals and null date for no rows', () => {
    const t = adTotals([]);
    expect(t.spend_cents).toBe(0);
    expect(t.leads).toBe(0);
    expect(t.cpl_cents).toBe(0);
    expect(t.campaigns).toHaveLength(0);
    expect(t.platforms).toHaveLength(0);
    expect(t.date_pulled).toBeNull();
  });
});

// Numbers taken from J&C's real Google Ads account 195-691-5350, Overview for
// Jul 1-30 2026: $680.53 cost, 117 clicks, 3,889 impressions, 3 leads.
const REAL_GOOGLE: GoogleAdsResponse = {
  results: [
    {
      campaign: { id: '22334455', name: 'Asphalt Campaign - 07/26' },
      metrics: { costMicros: '680530000', impressions: '3889', clicks: '117', conversions: 3 },
    },
  ],
};

describe('mapGoogleRowsToRows', () => {
  it("maps J&C's real Google payload, converting micros to cents", () => {
    const [r] = mapGoogleRowsToRows(REAL_GOOGLE, 'sess-1', '2026-07-31');
    expect(r.platform).toBe('google');
    expect(r.campaign_id).toBe('22334455');
    expect(r.campaign_name).toBe('Asphalt Campaign - 07/26');
    expect(r.spend_cents).toBe(68053); // 680530000 micros / 10000 = $680.53
    expect(r.impressions).toBe(3889);
    expect(r.clicks).toBe(117);
    expect(r.leads).toBe(3);
    expect(r.cpl_cents).toBe(22684); // round(68053 / 3) = $226.84
  });

  it('rounds fractional conversions and never divides by zero', () => {
    const frac: GoogleAdsResponse = {
      results: [{ campaign: { id: 'c1' }, metrics: { costMicros: '50000000', conversions: 0.4 } }],
    };
    const [r] = mapGoogleRowsToRows(frac, 's', '2026-07-31');
    expect(r.leads).toBe(0); // 0.4 rounds down -- do not claim a lead
    expect(r.cpl_cents).toBe(0);
    expect(r.spend_cents).toBe(5000);
  });

  it('skips rows with no campaign id and tolerates an empty payload', () => {
    expect(mapGoogleRowsToRows({ results: [{ metrics: { costMicros: '1' } }] }, 's', 'd')).toHaveLength(0);
    expect(mapGoogleRowsToRows({}, 's', 'd')).toHaveLength(0);
  });
});

describe('adTotals across Meta and Google on one card', () => {
  const bothPlatforms = (): AdMetricRow[] => [
    ...mapInsightsToRows(REAL_PAYLOAD, 'sess-1', '2026-07-31'),
    ...mapGoogleRowsToRows(REAL_GOOGLE, 'sess-1', '2026-07-31'),
  ];

  it('blends spend and leads across BOTH platforms', () => {
    const t = adTotals(bothPlatforms());
    expect(t.spend_cents).toBe(60523 + 68053); // $1,285.76
    expect(t.leads).toBe(22 + 3);
    // blended = 128576 / 25 = 5143 cents = $51.43
    expect(t.cpl_cents).toBe(5143);
  });

  it('splits per platform, ordered by spend desc, with each CPL intact', () => {
    const t = adTotals(bothPlatforms());
    expect(t.platforms.map((p) => p.platform)).toEqual(['google', 'meta']); // google outspent meta
    const meta = t.platforms.find((p) => p.platform === 'meta')!;
    const google = t.platforms.find((p) => p.platform === 'google')!;
    expect(meta.cpl_cents).toBe(2751); // $27.51
    expect(google.cpl_cents).toBe(22684); // $226.84 -- 8x more expensive
    expect(meta.campaigns).toHaveLength(1);
    expect(google.campaigns).toHaveLength(1);
  });

  it('reports the OLDEST pull date so the card never overstates freshness', () => {
    const rows = [
      ...mapInsightsToRows(REAL_PAYLOAD, 'sess-1', '2026-07-29'), // meta a day stale
      ...mapGoogleRowsToRows(REAL_GOOGLE, 'sess-1', '2026-07-31'),
    ];
    const t = adTotals(rows);
    expect(t.date_pulled).toBe('2026-07-29');
    expect(t.platforms.find((p) => p.platform === 'meta')!.date_pulled).toBe('2026-07-29');
    expect(t.platforms.find((p) => p.platform === 'google')!.date_pulled).toBe('2026-07-31');
  });
});
