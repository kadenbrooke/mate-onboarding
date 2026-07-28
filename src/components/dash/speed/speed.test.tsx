import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpeedZone } from './SpeedZone';
import type { Lead } from '@/lib/metrics/leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'A', phone: null, city: null, service: null,
  source: 'missed_call', referrer_name: null, score: 70, status: 'open', quote_cents: null,
  contacted: true, after_hours: true, first_reply_seconds: 28,
  created_at: new Date().toISOString(), ...over,
});

describe('SpeedZone', () => {
  it('renders race, streak, clock, rescue with computed stats', () => {
    render(<SpeedZone leads={[lead({}), lead({ after_hours: false })]} events={[]} />);
    expect(screen.getByText('SPEED TO LEAD')).toBeInTheDocument();
    expect(screen.getByText(/28\s?sec/i)).toBeInTheDocument();
    expect(screen.getByText('THE STREAK')).toBeInTheDocument();
    expect(screen.getByText('WHEN LEADS ARRIVE')).toBeInTheDocument();
    expect(screen.getByText('MISSED CALLS RESCUED')).toBeInTheDocument();
  });

  it('renders empty-state gracefully with zero leads', () => {
    render(<SpeedZone leads={[]} events={[]} />);
    expect(screen.getByText('SPEED TO LEAD')).toBeInTheDocument();
  });
});
