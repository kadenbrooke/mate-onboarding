import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdPerformanceZone } from './AdPerformanceZone';
import type { AdTotals } from '@/lib/metrics/ads';

// J&C's real shape: one campaign, $605.23 spend, 22 leads, $27.51 CPL.
const jcTotals: AdTotals = {
  spend_cents: 60523,
  leads: 22,
  cpl_cents: 2751,
  impressions: 31546,
  clicks: 439,
  date_pulled: '2026-07-29',
  campaigns: [{
    campaign_id: '120246899643110407',
    campaign_name: 'New J&C Leads Campaign',
    spend_cents: 60523,
    impressions: 31546,
    clicks: 439,
    leads: 22,
    cpl_cents: 2751,
  }],
};

describe('AdPerformanceZone', () => {
  it('shows an empty state with no ad data', () => {
    render(<AdPerformanceZone ads={null} />);
    expect(screen.getByText(/turns on with your first ad pull/i)).toBeInTheDocument();
  });

  it('leads with cost-per-lead in the ring center', () => {
    render(<AdPerformanceZone ads={jcTotals} />);
    // Center defaults to CPL. moneyShort(2751) -> "$28" (rounded whole dollars).
    expect(screen.getByTestId('ad-center-value').textContent).toBe('$28');
  });

  it('swaps the ring center to spend and leads on chip interaction', () => {
    render(<AdPerformanceZone ads={jcTotals} />);
    fireEvent.mouseEnter(screen.getByTestId('ad-chip-spend'));
    expect(screen.getByTestId('ad-center-value').textContent).toBe('$605');
    fireEvent.mouseEnter(screen.getByTestId('ad-chip-leads'));
    expect(screen.getByTestId('ad-center-value').textContent).toBe('22');
  });

  it('renders the per-campaign breakdown row', () => {
    render(<AdPerformanceZone ads={jcTotals} />);
    expect(screen.getByTestId('ad-campaign-120246899643110407')).toBeInTheDocument();
    expect(screen.getByText('New J&C Leads Campaign')).toBeInTheDocument();
    expect(screen.getByTestId('ad-seg-120246899643110407')).toBeInTheDocument();
  });

  it('shows the last-updated footer with the pull date', () => {
    render(<AdPerformanceZone ads={jcTotals} />);
    expect(screen.getByText(/updated 2026-07-29/i)).toBeInTheDocument();
  });
});
