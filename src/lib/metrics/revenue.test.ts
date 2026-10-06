import { describe, it, expect } from 'vitest';
import {
  revenueRowsFromLeads, summarizeReturn, metaSpend30dCents, addMonthsUtc, type SourceRevenueRow,
} from './revenue';
import { PARTNER_CHANNEL_SOURCES, channelOwner, partnerShareCents } from './partnerChannels';
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
  it('defaults: Meta ads and the partner web form are partner, the company lines are not', () => {
    expect(channelOwner('meta')).toBe('partner');
    expect(channelOwner('web_form')).toBe('partner');
    for (const s of ['call', 'text', 'typed', 'lead_snapshot', 'referral', 'google']) {
      expect(channelOwner(s), s).toBe('company');
    }
  });

  it('never claims an unmapped or retired source', () => {
    expect(channelOwner('meta_ads')).toBe('company');
    expect(channelOwner('nextdoor')).toBe('company');
  });

  it('maps every source the Lead type allows', () => {
    const owners = new Set(Object.values(PARTNER_CHANNEL_SOURCES));
    expect([...owners].every(o => o === 'partner' || o === 'company')).toBe(true);
  });

  it('15% rounds half up to whole cents', () => {
    expect(partnerShareCents(100000)).toBe(15000);
    expect(partnerShareCents(3)).toBe(0);
    expect(partnerShareCents(10)).toBe(2);
  });
});

describe('addMonthsUtc (Postgres month arithmetic in a UTC session)', () => {
  it('keeps the day and time, clamping to month end', () => {
    expect(addMonthsUtc(new Date('2024-01-31T10:00:00Z'), 24).toISOString()).toBe('2026-01-31T10:00:00.000Z');
    expect(addMonthsUtc(new Date('2024-02-29T10:00:00Z'), 24).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsUtc(new Date('2025-08-31T00:00:00Z'), 1).toISOString()).toBe('2025-09-30T00:00:00.000Z');
  });
});

describe('return per source', () => {
  it('recording a won job with cash updates that source and the 15% figure', () => {
    const meta = lead({ source: 'meta' });
    const leads = [meta, lead({ source: 'meta' }), lead({ source: 'call' }), lead({ source: 'web_form' })];

    const before = summarizeReturn(revenueRowsFromLeads(leads, NOW));
    expect(before.hasOutcomes).toBe(false);
    expect(before.partner).toMatchObject({ collectedCents: 0, shareCents: 0 });

    // Practice entry: the Meta lead closes at $6,400 and $3,200 is in.
    meta.job_outcome = 'won';
    meta.job_value_cents = 640000;
    meta.collected_cents = 320000;
    meta.collected_at = ago(2);

    const after = summarizeReturn(revenueRowsFromLeads(leads, NOW), { metaSpend30dCents: 80000 });
    const row = after.rows.find(r => r.source === 'meta')!;
    expect(row).toMatchObject({
      owner: 'partner', leads: 2, won: 1, lost: 0, winRate: 50,
      job_value_cents: 640000, collected_cents: 320000, collected_in_window_cents: 320000, collected_30d_cents: 320000,
    });
    expect(after.rows[0].source).toBe('meta'); // most cash first
    expect(after.partner).toEqual({ collectedCents: 320000, shareBps: 1500, shareCents: 48000, sources: ['meta', 'web_form'] });
    expect(after.meta).toEqual({ spend30dCents: 80000, collected30dCents: 320000, collectedCents: 320000, returnPerDollar: 4 });
    expect(after.totals).toEqual({ leads: 4, won: 1, lost: 0, jobValueCents: 640000, collectedCents: 320000 });
  });

  it('company-channel cash shows in the source return but never in the 15% basis', () => {
    const leads = [
      lead({ source: 'call', job_outcome: 'won', job_value_cents: 900000, collected_cents: 900000, collected_at: ago(1) }),
      lead({ source: 'web_form', job_outcome: 'won', job_value_cents: 200000, collected_cents: 100000, collected_at: ago(1) }),
      lead({ source: 'text', job_outcome: 'lost' }),
    ];
    const s = summarizeReturn(revenueRowsFromLeads(leads, NOW));
    expect(s.rows.find(r => r.source === 'call')).toMatchObject({ owner: 'company', collected_cents: 900000 });
    expect(s.rows.find(r => r.source === 'text')).toMatchObject({ lost: 1, winRate: 0 });
    expect(s.partner.collectedCents).toBe(100000);
    expect(s.partner.shareCents).toBe(15000);
    expect(s.hasOutcomes).toBe(true);
  });

  it('cash collected 24+ months after first contact is outside the window', () => {
    const leads = [
      lead({ source: 'meta', created_at: '2024-01-15T12:00:00.000Z', job_outcome: 'won',
        collected_cents: 50000, collected_at: '2026-01-15T12:00:00.000Z' }),
      lead({ source: 'meta', created_at: '2024-01-15T12:00:01.000Z', job_outcome: 'won',
        collected_cents: 70000, collected_at: '2026-01-15T12:00:00.000Z' }),
    ];
    const [row] = revenueRowsFromLeads(leads, NOW);
    expect(row.collected_cents).toBe(120000);
    expect(row.collected_in_window_cents).toBe(70000);
    expect(row.collected_30d_cents).toBe(0);
  });

  it('ignores money on a lead that is not won (defensive, the DB forbids it)', () => {
    const [row] = revenueRowsFromLeads([lead({ source: 'meta', job_outcome: 'lost', collected_cents: 100, collected_at: ago(1) })], NOW);
    expect(row).toMatchObject({ lost: 1, won: 0, collected_cents: 0 });
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
