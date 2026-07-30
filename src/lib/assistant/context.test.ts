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
  it('reports won/lost/open counts and total', () => {
    const leads = [mk({ status: 'won' }), mk({ status: 'won' }), mk({ status: 'lost' }), mk({ status: 'open' })];
    const ctx = buildAssistantContext(leads, 'Acme');
    expect(ctx).toContain('4 total leads');
    expect(ctx).toContain('2 won');
    expect(ctx).toContain('1 lost');
    expect(ctx).toContain('1 open');
  });
  it('reports revenue won in dollars', () => {
    const ctx = buildAssistantContext([mk({ status: 'won', quote_cents: 150000 })], 'Acme');
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
});
