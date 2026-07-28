import { describe, it, expect } from 'vitest';
import {
  weekBars, sourceBreakdown, pipelineTotals, valueWheel, areaRanking, scoreStats,
  monthBuckets, yearBuckets,
  type Lead,
} from './leads';

const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString();
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'x', name: 'A', city: 'Orem', service: 'Driveway', source: 'texted_in',
  referrer_name: null, score: 70, status: 'open', quote_cents: 300000,
  contacted: false, after_hours: false, first_reply_seconds: 20, created_at: d(0), ...over,
});

describe('weekBars', () => {
  it('returns 7 buckets Mon-Sun for the current week with counts', () => {
    const bars = weekBars([lead(), lead(), lead({ created_at: d(60) })]);
    expect(bars).toHaveLength(7);
    expect(bars.reduce((a, b) => a + b.count, 0)).toBe(2); // 60-day-old lead excluded
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

describe('monthBuckets', () => {
  it('returns 30 buckets and counts a today-lead in the last bucket', () => {
    const now = new Date();
    const todayLead = lead({ created_at: now.toISOString() });
    const buckets = monthBuckets([todayLead, lead({ created_at: d(60) })], now);
    expect(buckets).toHaveLength(30);
    expect(buckets[29]).toBe(1); // today's lead lands in the last (most recent) bucket
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(1); // 60-day-old lead excluded
  });
});

describe('yearBuckets', () => {
  it('returns 52 buckets and excludes a 400-day-old lead', () => {
    const now = new Date();
    const oldLead = lead({ created_at: d(400) });
    const recentLead = lead({ created_at: now.toISOString() });
    const buckets = yearBuckets([recentLead, oldLead], now);
    expect(buckets).toHaveLength(52);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(1); // 400-day-old lead excluded (>52 weeks)
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
