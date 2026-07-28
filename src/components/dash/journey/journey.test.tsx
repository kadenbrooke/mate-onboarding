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
});
