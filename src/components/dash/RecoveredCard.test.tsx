import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveredCard } from './RecoveredCard';
import { recoveredDailySeries } from '@/lib/metrics/recovered';
import type { Lead } from '@/lib/metrics/leads';

const NOW = new Date('2026-07-28T12:00:00');

function makePoints() {
  const leads = [{
    id: 'l1', name: 'X', city: null, service: null, source: 'referral',
    referrer_name: null, score: 80, status: 'won', quote_cents: 465_976,
    contacted: true, after_hours: false, first_reply_seconds: null,
    created_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
  }] as Lead[];
  return recoveredDailySeries(leads, 30, NOW);
}

describe('RecoveredCard', () => {
  it('renders delta badge, chart, and sparse date labels', () => {
    render(<RecoveredCard totalCents={465_976} roiMultiple={4.7} deltaCents={465_976} points={makePoints()} />);
    expect(screen.getByTestId('recovered-chart')).toBeInTheDocument();
    expect(screen.getByTestId('recovered-delta')).toHaveTextContent('$4,660');
    expect(screen.getByText('RECOVERED')).toBeInTheDocument();
    expect(screen.getByText(/4\.7x what you pay/)).toBeInTheDocument();
    // Sparse x-axis: exactly 5 short date labels like "Jul 3"
    const chart = screen.getByTestId('recovered-chart').parentElement!;
    const labels = Array.from(chart.querySelectorAll('span')).filter(s => /^[A-Z][a-z]{2} \d{1,2}$/.test(s.textContent ?? ''));
    expect(labels.length).toBe(5);
  });

  it('shows the crosshair readout on pointer move and clears on leave', () => {
    render(<RecoveredCard totalCents={465_976} roiMultiple={4.7} deltaCents={0} points={makePoints()} />);
    const chart = screen.getByTestId('recovered-chart');
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 300, height: 96, right: 300, bottom: 96, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    expect(screen.queryByTestId('recovered-readout')).toBeNull();
    fireEvent.pointerMove(chart, { clientX: 299 });
    const readout = screen.getByTestId('recovered-readout');
    // Rightmost point = cumulative total
    expect(readout).toHaveTextContent('$4,660');
    fireEvent.pointerLeave(chart);
    expect(screen.queryByTestId('recovered-readout')).toBeNull();
  });

  it('survives an empty series', () => {
    render(<RecoveredCard totalCents={0} roiMultiple={0} deltaCents={0} points={[]} />);
    expect(screen.getByTestId('recovered-chart')).toBeInTheDocument();
  });
});
