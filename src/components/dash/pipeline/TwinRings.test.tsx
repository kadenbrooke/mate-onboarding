import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TwinRings } from './TwinRings';
import type { Lead } from '@/lib/metrics/leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'A', city: null, service: null, phone: null, source: 'texted_in',
  referrer_name: null, score: null, status: 'open', quote_cents: 100000, contacted: true,
  after_hours: false, first_reply_seconds: null, created_at: new Date().toISOString(), ...over,
});

describe('TwinRings', () => {
  const leads = [
    lead({ status: 'won', quote_cents: 3820000 }),
    lead({ status: 'lost', quote_cents: 1000000 }),
    lead({ status: 'open', quote_cents: 9640000 }),
  ];

  it('defaults both centers to WON stats', () => {
    render(<TwinRings leads={leads} />);
    expect(screen.getByTestId('rev-center')).toHaveTextContent('$38.2k');
    expect(screen.getByTestId('lead-center')).toHaveTextContent('1');
  });

  it('clicking the open segment swaps the center stat', () => {
    render(<TwinRings leads={leads} />);
    fireEvent.click(screen.getByTestId('rev-seg-open'));
    expect(screen.getByTestId('rev-center')).toHaveTextContent('$96.4k');
  });

  it('shows avg job value beneath', () => {
    render(<TwinRings leads={leads} />);
    expect(screen.getByText(/AVG JOB/i)).toBeInTheDocument();
  });

  it('spells out both ring breakdowns in always-visible legends (no interaction)', () => {
    render(<TwinRings leads={leads} />);
    // Revenue ring legend: WON / LOST / ON THE TABLE by quote value.
    expect(screen.getByTestId('rev-legend-won').textContent).toContain('$38.2k');
    expect(screen.getByTestId('rev-legend-lost').textContent).toContain('$10.0k');
    expect(screen.getByTestId('rev-legend-open').textContent).toContain('$96.4k');
    // Leads ring legend: the same split by count.
    expect(screen.getByTestId('lead-legend-won').textContent).toContain('1');
    expect(screen.getByTestId('lead-legend-lost').textContent).toContain('1');
    expect(screen.getByTestId('lead-legend-open').textContent).toContain('1');
  });
});
