// src/lib/metrics/journey.test.ts
import { describe, it, expect } from 'vitest';
import { journeyRiver } from './journey';
import type { Lead } from './leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'A', phone: null, city: null, service: null,
  source: 'texted_in', referrer_name: null, score: null, status: 'open', quote_cents: 100000,
  contacted: true, after_hours: false, first_reply_seconds: 5,
  created_at: new Date().toISOString(), ...over,
});

describe('journeyRiver', () => {
  it('buckets sources, quoted band, and outcomes with counts', () => {
    const out = journeyRiver([
      lead({ source: 'referral', status: 'won' }),
      lead({ source: 'missed_call', status: 'open' }),
      lead({ source: 'missed_call', quote_cents: null, status: 'open' }),
    ]);
    expect(out.sources.find(s => s.source === 'missed_call')?.count).toBe(2);
    expect(out.quoted).toBe(2);          // leads with quote_cents
    expect(out.won).toBe(1);
    expect(out.open).toBe(2);
    expect(out.lost).toBe(0);
    expect(out.wonCents).toBe(100000);
  });

  it('counts lost leads as their own outcome', () => {
    const out = journeyRiver([
      lead({ status: 'lost' }),
      lead({ status: 'lost', source: 'referral' }),
      lead({ status: 'won' }),
    ]);
    expect(out.lost).toBe(2);
    expect(out.won).toBe(1);
    expect(out.open).toBe(0);
  });
});
