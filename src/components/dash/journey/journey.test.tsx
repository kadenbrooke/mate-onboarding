import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JourneyRiver } from './JourneyRiver';
import type { Lead } from '@/lib/metrics/leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'A', phone: null, city: null, service: null,
  source: 'referral', referrer_name: null, score: null, status: 'won', quote_cents: 500000,
  contacted: true, after_hours: false, first_reply_seconds: 5,
  created_at: new Date().toISOString(), ...over,
});

describe('JourneyRiver', () => {
  it('renders source labels, quoted count, and won outcome', () => {
    render(<JourneyRiver leads={[lead({}), lead({ source: 'missed_call', status: 'open' })]} />);
    expect(screen.getByText('LEAD JOURNEY')).toBeInTheDocument();
    expect(screen.getByText(/Won 1/)).toBeInTheDocument();
    expect(screen.getByText(/Still open 1/)).toBeInTheDocument();
  });

  it('renders nothing-yet state with zero leads', () => {
    render(<JourneyRiver leads={[]} />);
    expect(screen.getByText(/leads will flow here/i)).toBeInTheDocument();
  });

  it('3 distinct sources render 3 ribbon paths with unique destination y-coords', () => {
    const leads = [
      lead({ source: 'referral', status: 'won' }),
      lead({ source: 'missed_call', status: 'open' }),
      lead({ source: 'web_form', status: 'open' }),
    ];
    const { container } = render(<JourneyRiver leads={leads} />);
    const ribbons = container.querySelectorAll('[data-ribbon]');
    expect(ribbons).toHaveLength(3);
    // Each ribbon's d attribute must be unique (distinct destination y slices)
    const dAttrs = Array.from(ribbons).map(el => el.getAttribute('d'));
    const unique = new Set(dAttrs);
    expect(unique.size).toBe(3);
  });
});
