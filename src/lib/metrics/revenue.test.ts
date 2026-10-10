import { describe, it, expect, vi } from 'vitest';
import {
  revenueRowsFromLeads, summarizeReturn, metaSpend30dCents, fetchMetaSpend30dCents, addMonthsUtc,
  partnerBasisCents,
  type SourceRevenueRow, type LeadPayment, type AdSpendQuery, type RevenueLeadMessage,
} from './revenue';
import {
  PARTNER_CHANNEL_SOURCES, PARTNER_REFUND_CLAWBACK_WINDOW_MONTHS, channelOwner, partnerShareCents,
} from './partnerChannels';
import type { Lead } from './leads';

// All fixtures are invented practice data. No real lead data.
const NOW = new Date('2026-10-06T18:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString();

let n = 0;
function lead(over: Partial<Lead>): Lead {
  n += 1;
  return {
    id: `lead-${n}`, name: null, city: null, service: null, phone: null, source: 'meta',
    referrer_name: null, score: null, status: 'open', quote_cents: null, contacted: false,
    after_hours: false, first_reply_seconds: null, created_at: ago(40), ...over,
  };
}

describe('partner-channel config', () => {
  it('counts every known source as a partner channel', () => {
    for (const s of ['meta', 'web_form', 'revived', 'google', 'referral', 'call', 'text', 'typed', 'lead_snapshot', 'missed_call', 'texted_in', 'unknown', 'self_sourced']) {
      expect(channelOwner(s), s).toBe('partner');
    }
  });

  it('does not claim an unmapped source', () => {
    expect(channelOwner('meta_ads')).toBe('company');
    expect(channelOwner('nextdoor')).toBe('company');
  });

  it('maps every source the Lead type allows', () => {
    const owners = new Set(Object.values(PARTNER_CHANNEL_SOURCES));
    expect([...owners].every(o => o === 'partner' || o === 'company')).toBe(true);
  });

  it('treats a new referral brought by the review agent as a referral source', () => {
    const referral = lead({ source: 'referral', job_outcome: 'won', job_value_cents: 100000 });
    const summary = summarizeReturn(revenueRowsFromLeads([referral], [payFor(referral, 1000)], NOW));
    expect(summary.partner).toMatchObject({ collectedCents: 1000, shareCents: 150 });
  });

  it('15% rounds half up to whole cents', () => {
    expect(partnerShareCents(100000)).toBe(15000);
    expect(partnerShareCents(3)).toBe(0);
    expect(partnerShareCents(10)).toBe(2);
    expect(partnerShareCents(-100)).toBe(0);
  });

  it('counts a self-sourced lead only after the agent has messaged it', () => {
    const handedToAgent = lead({ source: 'self_sourced' as Lead['source'], job_outcome: 'won', job_value_cents: 100000 });
    const keptByOwner = lead({ source: 'self_sourced' as Lead['source'], job_outcome: 'won', job_value_cents: 100000 });
    const payments = [
      payFor(handedToAgent, 10000),
      payFor(keptByOwner, 20000),
    ];
    const messages: RevenueLeadMessage[] = [
      { lead_id: handedToAgent.id, direction: 'outbound', author: 'agent', source: 'fr' },
    ];
    const summary = summarizeReturn(revenueRowsFromLeads([handedToAgent, keptByOwner], payments, NOW, messages));
    expect(summary.rows.find(r => r.source === 'self_sourced')).toMatchObject({
      collected_cents: 30000,
      collected_in_window_cents: 30000,
      partner_collected_in_window_cents: 10000,
    });
    expect(summary.partner).toMatchObject({ collectedCents: 10000, shareCents: 1500 });
  });

  it('requires an identified counting agent and never treats a human or review message as one', () => {
    const fr = lead({ source: 'self_sourced' as Lead['source'] });
    const cultivator = lead({ source: 'self_sourced' as Lead['source'] });
    const review = lead({ source: 'self_sourced' as Lead['source'] });
    const human = lead({ source: 'self_sourced' as Lead['source'] });
    const untagged = lead({ source: 'self_sourced' as Lead['source'] });
    const leads = [fr, cultivator, review, human, untagged];
    const payments = leads.map(l => payFor(l, 1000));
    const messages: RevenueLeadMessage[] = [
      { lead_id: fr.id, direction: 'outbound', author: 'agent', source: 'fr' },
      { lead_id: cultivator.id, direction: 'outbound', author: 'agent', source: 'cultivator' },
      { lead_id: review.id, direction: 'outbound', author: 'agent', source: 'reputation' },
      { lead_id: human.id, direction: 'outbound', author: 'human', source: 'fr' },
      { lead_id: untagged.id, direction: 'outbound', author: 'agent' },
    ];

    const summary = summarizeReturn(revenueRowsFromLeads(leads, payments, NOW, messages));
    expect(summary.partner).toMatchObject({ collectedCents: 2000, shareCents: 300 });
  });

  it('keeps refunds out of the share when clawbacks are off, with a three-month fallback', () => {
    const payment = { lead_id: 'lead', amount_cents: 400000, paid_at: '2026-07-01T00:00:00.000Z' };
    const recentRefund = { lead_id: 'lead', amount_cents: -50000, paid_at: '2026-08-01T00:00:00.000Z' };
    const oldRefund = { lead_id: 'lead', amount_cents: -25000, paid_at: '2026-11-01T00:00:00.000Z' };

    expect(PARTNER_REFUND_CLAWBACK_WINDOW_MONTHS).toBe(0);
    expect(partnerBasisCents([payment, recentRefund], 0)).toBe(400000);
    expect(partnerBasisCents([payment, recentRefund], 3)).toBe(350000);
    expect(partnerBasisCents([payment, oldRefund], 3)).toBe(400000);
  });
});

function payFor(l: Lead, amount_cents: number): LeadPayment {
  return { lead_id: l.id, amount_cents, paid_at: ago(1) };
}

describe('addMonthsUtc (Postgres month arithmetic in a UTC session)', () => {
  it('keeps the day and time, clamping to month end', () => {
    expect(addMonthsUtc(new Date('2024-01-31T10:00:00Z'), 24).toISOString()).toBe('2026-01-31T10:00:00.000Z');
    expect(addMonthsUtc(new Date('2024-02-29T10:00:00Z'), 24).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsUtc(new Date('2025-08-31T00:00:00Z'), 1).toISOString()).toBe('2025-09-30T00:00:00.000Z');
  });
});

describe('return per source', () => {
  const pay = (l: Lead, amount_cents: number, paid_at: string): LeadPayment => ({ lead_id: l.id, amount_cents, paid_at });

  it('recording a won job with a payment updates that source and the 15% figure', () => {
    const meta = lead({ source: 'meta' });
    const leads = [meta, lead({ source: 'meta' }), lead({ source: 'call' }), lead({ source: 'web_form' })];

    const before = summarizeReturn(revenueRowsFromLeads(leads, [], NOW));
    expect(before.hasOutcomes).toBe(false);
    expect(before.partner).toMatchObject({ collectedCents: 0, shareCents: 0 });

    // Practice entry: the Meta lead closes at $6,400 and a $3,200 payment is in.
    meta.job_outcome = 'won';
    meta.job_value_cents = 640000;
    const payments = [pay(meta, 320000, ago(2))];

    const after = summarizeReturn(revenueRowsFromLeads(leads, payments, NOW), { metaSpend30dCents: 80000 });
    const row = after.rows.find(r => r.source === 'meta')!;
    expect(row).toMatchObject({
      owner: 'partner', leads: 2, won: 1, lost: 0, winRate: 50,
      job_value_cents: 640000, collected_cents: 320000, collected_in_window_cents: 320000, collected_30d_cents: 320000,
    });
    expect(after.rows[0].source).toBe('meta'); // most cash first
    expect(after.partner).toEqual({ collectedCents: 320000, shareBps: 1500, shareCents: 48000, sources: ['meta', 'call', 'web_form'] });
    expect(after.meta).toEqual({ spend30dCents: 80000, collected30dCents: 320000, collectedCents: 320000, returnPerDollar: 4 });
    expect(after.totals).toEqual({ leads: 4, won: 1, lost: 0, jobValueCents: 640000, collectedCents: 320000 });
  });

  it('$5,000 paid two months ago plus $1,000 this week is $1,000 in the last 30 days, not $6,000', () => {
    const meta = lead({ source: 'meta', created_at: ago(90), job_outcome: 'won', job_value_cents: 600000 });
    const rows = revenueRowsFromLeads([meta], [pay(meta, 500000, ago(60)), pay(meta, 100000, ago(3))], NOW);
    expect(rows[0]).toMatchObject({ collected_cents: 600000, collected_in_window_cents: 600000, collected_30d_cents: 100000 });
    const s = summarizeReturn(rows, { metaSpend30dCents: 50000 });
    expect(s.meta).toMatchObject({ collected30dCents: 100000, returnPerDollar: 2 });
    expect(s.partner).toMatchObject({ collectedCents: 600000, shareCents: 90000 });
  });

  it('counts payments after first contact because there is no cash cutoff', () => {
    const l = lead({ source: 'web_form', created_at: '2024-03-31T09:00:00.000Z', job_outcome: 'won' });
    const rows = revenueRowsFromLeads([l], [
      pay(l, 300000, '2024-05-01T12:00:00.000Z'), // deposit, inside
      pay(l, 200000, '2026-03-31T08:59:59.000Z'),
      pay(l, 150000, '2026-03-31T09:00:00.000Z'),
      pay(l, 50000, '2026-06-01T12:00:00.000Z'),
    ], NOW);
    expect(rows[0]).toMatchObject({ collected_cents: 700000, collected_in_window_cents: 700000 });
    expect(summarizeReturn(rows).partner).toMatchObject({ collectedCents: 700000, shareCents: 105000 });
  });

  it('a refund counts in the window it happened in', () => {
    const l = lead({ source: 'meta', created_at: ago(120), job_outcome: 'won' });
    const rows = revenueRowsFromLeads([l], [pay(l, 400000, ago(100)), pay(l, -50000, ago(5))], NOW);
    expect(rows[0]).toMatchObject({ collected_cents: 350000, collected_in_window_cents: 350000, collected_30d_cents: -50000 });
    expect(summarizeReturn(rows).partner).toMatchObject({ collectedCents: 400000, shareCents: 60000 });
  });

  it('every ordinary source cash amount enters the 15% basis', () => {
    const call = lead({ source: 'call', job_outcome: 'won', job_value_cents: 900000 });
    const web = lead({ source: 'web_form', job_outcome: 'won', job_value_cents: 200000 });
    const leads = [call, web, lead({ source: 'text', job_outcome: 'lost' })];
    const s = summarizeReturn(revenueRowsFromLeads(leads, [pay(call, 900000, ago(1)), pay(web, 100000, ago(1))], NOW));
    expect(s.rows.find(r => r.source === 'call')).toMatchObject({ owner: 'partner', collected_cents: 900000 });
    expect(s.rows.find(r => r.source === 'text')).toMatchObject({ lost: 1, winRate: 0 });
    expect(s.partner.collectedCents).toBe(1000000);
    expect(s.partner.shareCents).toBe(150000);
    expect(s.hasOutcomes).toBe(true);
  });

  it('ignores payments for leads it was not given', () => {
    const l = lead({ source: 'meta', job_outcome: 'won' });
    const [row] = revenueRowsFromLeads([l], [{ lead_id: 'someone-else', amount_cents: 999, paid_at: ago(1) }], NOW);
    expect(row.collected_cents).toBe(0);
  });

  it('no Meta spend means no return-per-dollar, not a divide by zero', () => {
    expect(summarizeReturn([]).meta.returnPerDollar).toBeNull();
    expect(summarizeReturn([], { metaSpend30dCents: 0 }).meta.returnPerDollar).toBeNull();
  });

  it('coerces view rows that arrive as strings (bigint over the wire)', () => {
    const rows = [{ source: 'meta', leads: '3', won: '1', lost: '0', job_value_cents: '1000', collected_cents: '500',
      collected_in_window_cents: '500', collected_30d_cents: '0' }] as unknown as SourceRevenueRow[];
    expect(summarizeReturn(rows).partner.collectedCents).toBe(500);
  });
});

describe('metaSpend30dCents', () => {
  const row = (campaign_id: string, date_pulled: string, spend_cents: number, platform: 'meta' | 'google' = 'meta') =>
    ({ platform, campaign_id, date_pulled, spend_cents });

  it('takes each campaign\'s newest rolling snapshot, never a sum across days', () => {
    expect(metaSpend30dCents([
      row('c1', '2026-10-06', 60000), row('c1', '2026-10-05', 58000), row('c1', '2026-10-04', 55000),
      row('c2', '2026-10-06', 20000), row('c2', '2026-10-05', 21000),
      row('g1', '2026-10-06', 99999, 'google'),
    ])).toBe(80000);
  });

  it('drops a campaign that fell out of the newest pull (no delivery in the window)', () => {
    expect(metaSpend30dCents([row('c1', '2026-10-06', 60000), row('old', '2026-09-01', 40000)])).toBe(60000);
  });

  it('is null without Meta rows', () => {
    expect(metaSpend30dCents([])).toBeNull();
    expect(metaSpend30dCents([row('g', '2026-10-06', 1, 'google')])).toBeNull();
  });
});

describe('fetchMetaSpend30dCents (no row cap)', () => {
  type Row = { platform: 'meta' | 'google'; campaign_id: string; spend_cents: number; date_pulled: string };
  // A structural stub of the two ad_metrics reads, over invented rows.
  function stub(rows: Row[], fail: 'newest' | 'pull' | null = null) {
    const calls: string[] = [];
    const q = {
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => {
                  calls.push(cols);
                  if (fail === 'newest') return { data: null, error: { message: 'boom' } };
                  const meta = rows.filter(r => r.platform === 'meta').sort((a, b) => b.date_pulled.localeCompare(a.date_pulled));
                  return { data: meta.slice(0, 1).map(r => ({ date_pulled: r.date_pulled })), error: null };
                },
              }),
              eq: async (_c: string, day: string) => {
                calls.push(cols);
                if (fail === 'pull') return { data: null, error: { message: 'boom' } };
                return { data: rows.filter(r => r.platform === 'meta' && r.date_pulled === day), error: null };
              },
            }),
          }),
        }),
      }),
    };
    return { q: q as unknown as AdSpendQuery, calls };
  }

  it('sums every campaign in the newest pull, however many older rows exist', async () => {
    const rows: Row[] = [];
    // 150 old daily snapshots would have pushed the newest pull past a 100-row cap.
    for (let d = 1; d <= 150; d++) rows.push({ platform: 'meta', campaign_id: `c${d % 3}`, spend_cents: 99999, date_pulled: `2026-0${1 + (d % 8)}-01` });
    for (let c = 0; c < 120; c++) rows.push({ platform: 'meta', campaign_id: `new${c}`, spend_cents: 1000, date_pulled: '2026-10-06' });
    rows.push({ platform: 'google', campaign_id: 'g', spend_cents: 5, date_pulled: '2026-10-07' });
    const { q } = stub(rows);
    expect(await fetchMetaSpend30dCents(q, 's1')).toBe(120000);
  });

  it('is null without Meta data or when a read fails', async () => {
    expect(await fetchMetaSpend30dCents(stub([]).q, 's1')).toBeNull();
    const rows: Row[] = [{ platform: 'meta', campaign_id: 'c', spend_cents: 1, date_pulled: '2026-10-06' }];
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fetchMetaSpend30dCents(stub(rows, 'newest').q, 's1')).toBeNull();
    expect(await fetchMetaSpend30dCents(stub(rows, 'pull').q, 's1')).toBeNull();
    err.mockRestore();
  });
});
