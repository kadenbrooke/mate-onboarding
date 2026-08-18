// src/lib/metrics/speed.test.ts
import { describe, it, expect } from 'vitest';
import { speedStats } from './speed';
import type { Lead } from './leads';

const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString();
const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'A', phone: null, city: null, service: null,
  source: 'texted_in', referrer_name: null, score: 70, status: 'open', quote_cents: null,
  contacted: true, after_hours: false, first_reply_seconds: 20, created_at: d(0), ...over,
});

describe('speedStats', () => {
  it('computes avg reply seconds, after-hours count, hour histogram', () => {
    const out = speedStats([
      lead({ first_reply_seconds: 10 }),
      lead({ first_reply_seconds: 30, after_hours: true }),
      lead({ first_reply_seconds: null }),
    ]);
    expect(out.avgReplySeconds).toBe(20);
    expect(out.afterHoursCount).toBe(1);
    expect(out.hourCounts).toHaveLength(24);
    expect(out.hourCounts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('streakDays = days since last unanswered lead, capped at first lead age', () => {
    const out = speedStats([
      lead({ first_reply_seconds: 10, created_at: d(40) }),
      lead({ first_reply_seconds: null, created_at: d(12) }),
      lead({ first_reply_seconds: 9, created_at: d(1) }),
    ]);
    expect(out.streakDays).toBe(12);
  });

  it('streak with no unanswered leads = age of oldest lead', () => {
    const out = speedStats([lead({ created_at: d(30) }), lead({ created_at: d(2) })]);
    expect(out.streakDays).toBe(30);
  });

  it('rescue: call leads counted as rescued of total missed calls (rescued + unrescued events)', () => {
    const out = speedStats(
      [lead({ source: 'call' }), lead({ source: 'call' }), lead({ source: 'texted_in' })],
      4, // totalMissedCalls (from events; 2 rescued + 2 lost)
    );
    expect(out.rescued).toBe(2);
    expect(out.missedTotal).toBe(4);
  });

  it('missedTotal is null when nothing independently counts missed calls', () => {
    // The bug this replaces: missedTotal fell back to `rescued`, so a session
    // with no missed-call events rendered "N of N rescued" -- a 100% rescue
    // rate built entirely out of its own numerator.
    const out = speedStats([lead({ source: 'call' }), lead({ source: 'call' })]);
    expect(out.rescued).toBe(2);
    expect(out.missedTotal).toBeNull();
  });

  it('never lets the denominator fall below the rescued count', () => {
    // A missed-call total smaller than the rescues is inconsistent upstream
    // data; clamping keeps the rate at or below 100% instead of rendering 3/1.
    const out = speedStats([lead({ source: 'call' }), lead({ source: 'call' }), lead({ source: 'call' })], 1);
    expect(out.missedTotal).toBe(3);
  });

  it('avgReplySeconds is null when no lead has a measured reply time', () => {
    // Not 0: a 0 rendered as an instant-response brag from missing data.
    const out = speedStats([
      lead({ first_reply_seconds: null }),
      lead({ first_reply_seconds: null }),
    ]);
    expect(out.avgReplySeconds).toBeNull();
    expect(out.repliedCount).toBe(0);
    expect(out.leadCount).toBe(2);
  });

  it('reports a genuine zero-second average as 0, distinct from null', () => {
    const out = speedStats([lead({ first_reply_seconds: 0 })]);
    expect(out.avgReplySeconds).toBe(0);
    expect(out.repliedCount).toBe(1);
  });

  it('rescue: legacy missed_call value still counts (pre-2026-08-05 rows)', () => {
    const out = speedStats([lead({ source: 'missed_call' })]);
    expect(out.rescued).toBe(1);
  });
});
