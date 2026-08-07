import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MoneyZone } from './MoneyZone';
import type { MoneyTotals } from '@/lib/metrics/money';

const totals: MoneyTotals = {
  revenue_cents: 1_250_000, // $12.5k
  expenses_cents: 400_000,  // $4k
  profit_cents: 850_000,    // $8.5k
  ar_cents: 320_000,        // $3,200
  invoices_outstanding: 4,
  collected_cents: 900_000, // $9k
  period: '2026-07',
  period_start: '2026-07-01',
  period_end: '2026-07-31',
  date_pulled: '2026-08-01',
};

describe('MoneyZone', () => {
  it('shows an empty state when QuickBooks is not connected', () => {
    render(<MoneyZone money={null} />);
    expect(screen.getByText(/turns on when your quickbooks is connected/i)).toBeInTheDocument();
  });

  it('leads with revenue for the period', () => {
    render(<MoneyZone money={totals} />);
    // moneyShort(1_250_000) -> "$12.5k"
    expect(screen.getByTestId('money-revenue').textContent).toBe('$12.5k');
  });

  it('shows collected-this-month and outstanding receivables', () => {
    render(<MoneyZone money={totals} />);
    expect(screen.getByTestId('money-collected')).toBeInTheDocument();
    const ar = screen.getByTestId('money-ar');
    expect(ar).toBeInTheDocument();
    expect(ar.textContent).toContain('4 invoices');
  });

  it('shows expenses and profit only when expenses are present', () => {
    render(<MoneyZone money={totals} />);
    expect(screen.getByTestId('money-expenses')).toBeInTheDocument();
    expect(screen.getByTestId('money-profit')).toBeInTheDocument();
  });

  it('hides the expenses/profit rows when there are no expenses', () => {
    render(<MoneyZone money={{ ...totals, expenses_cents: 0 }} />);
    expect(screen.queryByTestId('money-expenses')).toBeNull();
    expect(screen.queryByTestId('money-profit')).toBeNull();
  });

  it('shows the period and last-updated footer', () => {
    render(<MoneyZone money={totals} />);
    expect(screen.getByText(/July 2026/)).toBeInTheDocument();
    expect(screen.getByText(/updated 2026-08-01/)).toBeInTheDocument();
  });

  it('singularizes the invoice count', () => {
    render(<MoneyZone money={{ ...totals, invoices_outstanding: 1 }} />);
    expect(screen.getByTestId('money-ar').textContent).toContain('1 invoice');
  });
});
