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
      lead({ source: 'referral', status: 'serviced' }),
      lead({ source: 'missed_call', status: 'open' }),
      lead({ source: 'missed_call', quote_cents: null, status: 'open' }),
    ]);
    expect(out.sources.find(s => s.source === 'missed_call')?.count).toBe(2);
    expect(out.priced).toBe(2);          // leads with quote_cents
    expect(out.serviced).toBe(1);
    expect(out.open).toBe(2);
    expect(out.quoted).toBe(0);
    expect(out.servicedCents).toBe(100000);
  });

  it('counts each pipeline stage as its own branch', () => {
    const out = journeyRiver([
      lead({ status: 'quoted' }),
      lead({ status: 'quoted', source: 'referral' }),
      lead({ status: 'booked' }),
      lead({ status: 'serviced' }),
    ]);
    expect(out.quoted).toBe(2);
    expect(out.booked).toBe(1);
    expect(out.serviced).toBe(1);
    expect(out.open).toBe(0);
  });
});
