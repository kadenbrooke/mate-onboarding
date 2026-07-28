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

  it('rescue: missed_call leads counted as rescued of total missed calls (rescued + unrescued events)', () => {
    const out = speedStats(
      [lead({ source: 'missed_call' }), lead({ source: 'missed_call' }), lead({ source: 'texted_in' })],
      4, // totalMissedCalls (from events; 2 rescued + 2 lost)
    );
    expect(out.rescued).toBe(2);
    expect(out.missedTotal).toBe(4);
  });

  it('missedTotal defaults to rescued count when no event total supplied', () => {
    const out = speedStats([lead({ source: 'missed_call' })]);
    expect(out.missedTotal).toBe(1);
  });
});
