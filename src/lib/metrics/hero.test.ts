import { describe, it, expect } from 'vitest';
import { heroStats, weeklyBuckets, trendPct, heroSeries } from './hero';
import type { Lead } from './leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: 'x', name: 'A', city: null, service: null, phone: null, source: 'texted_in', referrer_name: null,
  score: null, status: 'open', quote_cents: null, contacted: false, after_hours: false,
  first_reply_seconds: 20, created_at: new Date().toISOString(), ...over,
});

describe('heroStats', () => {
  it('computes recovered $, roi multiple, actions, hours saved', () => {
    const out = heroStats(
      [lead({ status: 'serviced', quote_cents: 3820000 })],
      { monthlyRetainerCents: 100000, actionsThisWeek: 212, minutesPerAction: 5 },
    );
    expect(out.recoveredCents).toBe(3820000);
    expect(out.roiMultiple).toBeCloseTo(38.2);
    expect(out.actions).toBe(212);
    expect(out.hoursSaved).toBe(18); // 212 * 5 / 60 rounded
  });

  it('returns a null ROI when the retainer is unknown, never a 0x', () => {
    // The retainer is read from the client's CRM contact. No contact, no
    // retainer, no ROI claim: dividing recovered revenue by a guessed retainer
    // is how the hardcoded $1,000 default produced a right-by-luck multiple.
    for (const retainer of [null, 0]) {
      const out = heroStats(
        [lead({ status: 'serviced', quote_cents: 500000 })],
        { monthlyRetainerCents: retainer, actionsThisWeek: 0, minutesPerAction: 5 },
      );
      expect(out.recoveredCents).toBe(500000);
      expect(out.roiMultiple).toBeNull();
    }
  });

  it('scales the ROI multiple with the actual retainer on the contact', () => {
    const leads = [lead({ status: 'serviced', quote_cents: 1000000 })];
    expect(heroStats(leads, { monthlyRetainerCents: 100000, actionsThisWeek: 0, minutesPerAction: 5 }).roiMultiple)
      .toBeCloseTo(10);
    expect(heroStats(leads, { monthlyRetainerCents: 250000, actionsThisWeek: 0, minutesPerAction: 5 }).roiMultiple)
      .toBeCloseTo(4);
  });
});

describe('weeklyBuckets + trendPct', () => {
  const now = new Date('2026-07-28T12:00:00Z');
  it('buckets items into trailing 7-day windows, oldest first', () => {
    const items = [
      { at: '2026-07-27T12:00:00Z', value: 100 },  // this week (0 weeks ago)
      { at: '2026-07-20T12:00:00Z', value: 40 },   // last week
      { at: '2026-05-01T12:00:00Z', value: 7 },    // outside 8-week window
    ];
    const b = weeklyBuckets(items, 8, now);
    expect(b).toHaveLength(8);
    expect(b[7]).toBe(100);
    expect(b[6]).toBe(40);
    expect(b.reduce((a, x) => a + x, 0)).toBe(140);
  });
  it('trendPct compares last two buckets', () => {
    expect(trendPct([0, 40, 100])).toBe(150);
    expect(trendPct([0, 0, 100])).toBe(100);
    expect(trendPct([0, 0, 0])).toBe(0);
    expect(trendPct([0, 100, 40])).toBe(-60);
  });
});

describe('heroSeries', () => {
  it('builds recovered/hours/actions series from leads and events', () => {
    const now = new Date('2026-07-28T12:00:00Z');
    const leads = [
      lead({ status: 'serviced', quote_cents: 200000, created_at: '2026-07-27T12:00:00Z' }),
      lead({ status: 'serviced', quote_cents: 100000, created_at: '2026-07-20T12:00:00Z' }),
    ];
    const events = [
      { id: 'e1', agent: 'first_responder', kind: 'sms', message: 'x', created_at: '2026-07-27T12:00:00Z' },
    ] as const;
    const s = heroSeries(leads, [...events], { minutesPerAction: 30 }, now);
    expect(s.recovered.buckets[7]).toBe(200000);
    expect(s.recovered.buckets[6]).toBe(100000);
    expect(s.recovered.trendPct).toBe(100);
    expect(s.actions.buckets[7]).toBe(1);
    expect(s.hours.buckets[7]).toBeCloseTo(0.5);
  });

  it('buckets revenue by when the job was serviced, not when the lead arrived', () => {
    const now = new Date('2026-07-28T12:00:00Z');
    const leads = [
      // Arrived 5 weeks ago, serviced this week: the money is this week's.
      lead({
        status: 'serviced', quote_cents: 300000,
        created_at: '2026-06-22T12:00:00Z', status_updated_at: '2026-07-27T12:00:00Z',
      }),
    ];
    const s = heroSeries(leads, [], { minutesPerAction: 30 }, now);
    expect(s.recovered.buckets[7]).toBe(300000);
    expect(s.recovered.buckets[2]).toBe(0);
  });

  it('falls back to created_at for serviced rows with no status stamp', () => {
    const now = new Date('2026-07-28T12:00:00Z');
    const leads = [lead({ status: 'serviced', quote_cents: 150000, created_at: '2026-07-27T12:00:00Z', status_updated_at: null })];
    expect(heroSeries(leads, [], { minutesPerAction: 30 }, now).recovered.buckets[7]).toBe(150000);
  });
});
