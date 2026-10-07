import { describe, it, expect } from 'vitest';
import type { Lead } from '@/lib/metrics/leads';
import { buildAssistantContext } from './context';

const mk = (o: Partial<Lead>): Lead => ({
  id: 'x', name: null, city: null, service: null, phone: null,
  source: o.source ?? 'unknown', referrer_name: null, score: o.score ?? null,
  status: o.status ?? 'open', quote_cents: o.quote_cents ?? null,
  contacted: false, after_hours: false, first_reply_seconds: o.first_reply_seconds ?? null,
  created_at: '2026-07-01T00:00:00Z',
});

describe('buildAssistantContext', () => {
  it('names the business and states it is their assistant', () => {
    const ctx = buildAssistantContext([], 'J&C Asphalt');
    expect(ctx).toContain('J&C Asphalt');
    expect(ctx.toLowerCase()).toContain('assistant');
  });
  it('handles a null business name without crashing', () => {
    expect(buildAssistantContext([], null)).toContain('your business');
  });
  it('reports per-stage counts and total', () => {
    const leads = [mk({ status: 'serviced' }), mk({ status: 'serviced' }), mk({ status: 'quoted' }), mk({ status: 'open' })];
    const ctx = buildAssistantContext(leads, 'Acme');
    expect(ctx).toContain('4 total leads');
    expect(ctx).toContain('2 serviced');
    expect(ctx).toContain('1 quoted');
    expect(ctx).toContain('1 open');
  });
  it('reports revenue from serviced jobs in dollars', () => {
    const ctx = buildAssistantContext([mk({ status: 'serviced', quote_cents: 150000 })], 'Acme');
    expect(ctx).toContain('$1,500');
  });
  it('reports average first-reply time when present', () => {
    const ctx = buildAssistantContext(
      [mk({ first_reply_seconds: 60 }), mk({ first_reply_seconds: 120 })], 'Acme');
    expect(ctx).toContain('90');
  });
  it('instructs the model to only answer from the data given', () => {
    const ctx = buildAssistantContext([], 'Acme').toLowerCase();
    expect(ctx).toContain('only');
  });
  it('reports return by lead source from the view rows, never the partner share', () => {
    const rows = [
      { source: 'meta', leads: 2, won: 1, lost: 0, job_value_cents: 500000, collected_cents: 250000, collected_in_window_cents: 250000, collected_30d_cents: 0 },
      { source: 'call', leads: 1, won: 0, lost: 0, job_value_cents: 0, collected_cents: 0, collected_in_window_cents: 0, collected_30d_cents: 0 },
    ];
    const ctx = buildAssistantContext([mk({ source: 'meta' })], 'Acme', rows);
    expect(ctx).toContain('Meta Ads: 1 won, 0 lost of 2 leads, $5,000 sold, $2,500 collected');
    expect(ctx).not.toContain('Call:');
    expect(ctx).not.toMatch(/15%|partner/i);
  });
  it('says plainly when no outcomes are entered', () => {
    const rows = [{ source: 'text', leads: 1, won: 0, lost: 0, job_value_cents: 0, collected_cents: 0, collected_in_window_cents: 0, collected_30d_cents: 0 }];
    expect(buildAssistantContext([mk({})], 'Acme', rows)).toContain('no jobs have been marked won or lost yet');
  });
  it('says nothing about returns when they are unavailable', () => {
    expect(buildAssistantContext([mk({})], 'Acme')).not.toMatch(/return by lead source/i);
  });
});
