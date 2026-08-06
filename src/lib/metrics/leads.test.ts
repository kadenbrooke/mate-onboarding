import { describe, it, expect } from 'vitest';
import {
  weekBars, sourceBreakdown, pipelineTotals, valueWheel, areaRanking, scoreStats,
  monthBuckets, yearBuckets, leadsInPeriod, outcomesInPeriod,
  leadsInRange, outcomesInRange, customBuckets, periodStart,
  type Lead,
} from './leads';

const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString();
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'x', name: 'A', city: 'Orem', service: 'Driveway', phone: null, source: 'texted_in',
  referrer_name: null, score: 70, status: 'open', quote_cents: 300000,
  contacted: false, after_hours: false, first_reply_seconds: 20, created_at: d(0), ...over,
});

// Fixed reference point for the calendar-period tests: Thu Aug 6 2026, noon.
// Its Sun..Sat week is Aug 2 (Sun) .. Aug 8 (Sat).
const NOW = new Date(2026, 7, 6, 12, 0, 0);
const at = (y: number, m: number, day: number) => new Date(y, m, day, 9, 0, 0).toISOString();

describe('weekBars (Sunday start, static Su..Sa)', () => {
  it('labels the 7 buckets Su..Sa and counts only this calendar week', () => {
    const bars = weekBars([
      lead({ created_at: at(2026, 7, 3) }), // Mon Aug 3
      lead({ created_at: at(2026, 7, 4) }), // Tue Aug 4
      lead({ created_at: at(2026, 7, 1) }), // Sat Aug 1 -> prior week, excluded
    ], NOW);
    expect(bars.map(b => b.day)).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
    expect(bars).toHaveLength(7);
    // This Sun..Sat week is Aug 2..Aug 8: Aug 3 (Mo) + Aug 4 (Tu) = 2.
    expect(bars.reduce((a, b) => a + b.count, 0)).toBe(2);
    expect(bars[1].count).toBe(1); // Monday holds Aug 3
    expect(bars[2].count).toBe(1); // Tuesday holds Aug 4
    expect(bars[6].count).toBe(0); // Saturday (Aug 8) empty
  });
});

describe('sourceBreakdown', () => {
  it('counts by source and computes freeCount (referral + revived)', () => {
    const out = sourceBreakdown([
      lead({ source: 'referral' }), lead({ source: 'revived' }),
      lead({ source: 'missed_call' }), lead({ source: 'missed_call' }),
    ]);
    expect(out.freeCount).toBe(2);
    expect(out.segments.find(s => s.source === 'missed_call')?.count).toBe(2);
  });
});

describe('pipelineTotals', () => {
  it('sums cents and counts by status', () => {
    const out = pipelineTotals([
      lead({ status: 'won', quote_cents: 100000 }),
      lead({ status: 'lost', quote_cents: 50000 }),
      lead({ status: 'open', quote_cents: 200000 }),
      lead({ status: 'open', quote_cents: null }),
    ]);
    expect(out.wonCents).toBe(100000);
    expect(out.lostCents).toBe(50000);
    expect(out.openCents).toBe(200000);
    expect(out.counts).toEqual({ won: 1, lost: 1, open: 2 });
    expect(out.winRate).toBe(50); // won / (won + lost)
  });
});

describe('valueWheel', () => {
  it('returns per-service share of leads and avg quote', () => {
    const out = valueWheel([
      lead({ service: 'Driveway', quote_cents: 200000 }),
      lead({ service: 'Driveway', quote_cents: 400000 }),
      lead({ service: 'Sealcoat', quote_cents: 100000 }),
    ]);
    const drive = out.find(s => s.service === 'Driveway')!;
    expect(drive.count).toBe(2);
    expect(drive.share).toBeCloseTo(2 / 3);
    expect(drive.avgCents).toBe(300000);
  });
});

describe('areaRanking', () => {
  it('ranks cities by count desc', () => {
    const out = areaRanking([lead({ city: 'Provo' }), lead({ city: 'Orem' }), lead({ city: 'Orem' })]);
    expect(out[0]).toMatchObject({ city: 'Orem', count: 2 });
  });
});

describe('monthBuckets (calendar month to date, daily)', () => {
  it('returns one bucket per day of this month, today in the last bucket', () => {
    const buckets = monthBuckets([
      lead({ created_at: at(2026, 7, 1) }),  // Aug 1
      lead({ created_at: at(2026, 7, 6) }),  // Aug 6 (today)
      lead({ created_at: at(2026, 6, 30) }), // Jul 30 (prior month, excluded)
    ], NOW);
    expect(buckets).toHaveLength(6); // days 1..6
    expect(buckets[0]).toBe(1);      // Aug 1
    expect(buckets[5]).toBe(1);      // Aug 6 (today, last bucket)
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(2); // Jul lead excluded
  });
});

describe('yearBuckets (calendar year to date, monthly)', () => {
  it('returns one bucket per month Jan..this month, this month last', () => {
    const buckets = yearBuckets([
      lead({ created_at: at(2026, 0, 15) }),  // Jan
      lead({ created_at: at(2026, 7, 4) }),   // Aug
      lead({ created_at: at(2025, 11, 20) }), // prior-year Dec, excluded
    ], NOW);
    expect(buckets).toHaveLength(8); // Jan..Aug
    expect(buckets[0]).toBe(1);      // Jan
    expect(buckets[7]).toBe(1);      // Aug (this month, last bucket)
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(2); // prior-year lead excluded
  });
});

describe('periodStart / leadsInPeriod / outcomesInPeriod', () => {
  it('starts WEEK on Sunday, MONTH on the 1st, YEAR on Jan 1', () => {
    expect(periodStart('WEEK', NOW).getTime()).toBe(new Date(2026, 7, 2).getTime());
    expect(periodStart('MONTH', NOW).getTime()).toBe(new Date(2026, 7, 1).getTime());
    expect(periodStart('YEAR', NOW).getTime()).toBe(new Date(2026, 0, 1).getTime());
  });

  it('counts leads per calendar period (WEEK=2, MONTH=3 for the sanity data)', () => {
    const leads = [
      lead({ created_at: at(2026, 7, 1) }), // Aug 1 (this month, prior week)
      lead({ created_at: at(2026, 7, 3) }), // Aug 3 (this week)
      lead({ created_at: at(2026, 7, 4) }), // Aug 4 (this week)
      lead({ created_at: at(2026, 6, 20) }), // Jul 20 (prior month, this year)
    ];
    expect(leadsInPeriod(leads, 'WEEK', NOW)).toHaveLength(2);
    expect(leadsInPeriod(leads, 'MONTH', NOW)).toHaveLength(3);
    expect(leadsInPeriod(leads, 'YEAR', NOW)).toHaveLength(4);
  });

  it('tallies won/open/lost within the period', () => {
    const leads = [
      lead({ created_at: at(2026, 7, 3), status: 'won' }),
      lead({ created_at: at(2026, 7, 4), status: 'lost' }),
      lead({ created_at: at(2026, 7, 1), status: 'open' }), // prior week
    ];
    expect(outcomesInPeriod(leads, 'WEEK', NOW)).toMatchObject({ won: 1, lost: 1, open: 0, total: 2 });
  });
});

describe('custom range: leadsInRange / outcomesInRange / customBuckets', () => {
  const leads = [
    lead({ created_at: at(2026, 6, 20), status: 'won' }), // Jul 20
    lead({ created_at: at(2026, 6, 25), status: 'open' }), // Jul 25
    lead({ created_at: at(2026, 7, 4), status: 'lost' }),  // Aug 4
  ];

  it('counts leads inclusive of both endpoints', () => {
    // Jul 20 .. Aug 4 inclusive = all three.
    expect(leadsInRange(leads, at(2026, 6, 20), at(2026, 7, 4))).toHaveLength(3);
    // Jul 21 .. Aug 3 excludes both endpoints' leads.
    expect(leadsInRange(leads, at(2026, 6, 21), at(2026, 7, 3))).toHaveLength(1);
    expect(outcomesInRange(leads, at(2026, 6, 20), at(2026, 7, 4)))
      .toMatchObject({ won: 1, open: 1, lost: 1, total: 3 });
  });

  it('returns empty for an inverted range', () => {
    expect(leadsInRange(leads, at(2026, 7, 4), at(2026, 6, 20))).toHaveLength(0);
    expect(customBuckets(leads, at(2026, 7, 4), at(2026, 6, 20)).counts).toHaveLength(0);
  });

  it('uses daily buckets for a short span (<= 31 days)', () => {
    // Aug 1 .. Aug 6 = 6 daily buckets.
    const { counts, labels } = customBuckets(leads, at(2026, 7, 1), at(2026, 7, 6));
    expect(counts).toHaveLength(6);
    expect(labels).toHaveLength(6);
    expect(counts[3]).toBe(1); // Aug 4 lead lands in bucket index 3
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('collapses a long span to weekly buckets, still totalling correctly', () => {
    // ~60-day span -> weekly buckets (<= 366 days).
    const { counts } = customBuckets(leads, at(2026, 6, 1), at(2026, 7, 30));
    expect(counts.length).toBeLessThan(15); // not 60 daily bars
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3); // all three leads inside
  });
});

describe('scoreStats', () => {
  it('averages scores and returns hot uncontacted leads sorted score-desc', () => {
    const out = scoreStats([
      lead({ score: 90, contacted: false, name: 'Hot' }),
      lead({ score: 50, contacted: true }),
      lead({ score: 80, contacted: false }),
    ]);
    expect(out.avg).toBe(73);
    expect(out.hot[0].name).toBe('Hot');
    expect(out.hot.every(l => !l.contacted)).toBe(true);
  });
});
