import { describe, it, expect } from 'vitest';
import { heroStats } from './hero';
import type { Lead } from './leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: 'x', name: 'A', city: null, service: null, source: 'texted_in', referrer_name: null,
  score: null, status: 'open', quote_cents: null, contacted: false, after_hours: false,
  first_reply_seconds: 20, created_at: new Date().toISOString(), ...over,
});

describe('heroStats', () => {
  it('computes recovered $, roi multiple, actions, hours saved', () => {
    const out = heroStats(
      [lead({ status: 'won', quote_cents: 3820000 })],
      { monthlyRetainerCents: 100000, actionsThisWeek: 212, minutesPerAction: 5 },
    );
    expect(out.recoveredCents).toBe(3820000);
    expect(out.roiMultiple).toBeCloseTo(38.2);
    expect(out.actions).toBe(212);
    expect(out.hoursSaved).toBe(18); // 212 * 5 / 60 rounded
  });
});
