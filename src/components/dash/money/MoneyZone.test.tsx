import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  // --- Revenue ring: revenue split into expenses + profit ---

  describe('revenue ring', () => {
    it('renders both ring segments when expenses are present', () => {
      render(<MoneyZone money={totals} />);
      expect(screen.getByTestId('money-seg-expenses')).toBeInTheDocument();
      expect(screen.getByTestId('money-seg-profit')).toBeInTheDocument();
    });

    it('rests with revenue in the center', () => {
      render(<MoneyZone money={totals} />);
      expect(screen.getByTestId('money-revenue').textContent).toBe('$12.5k');
      expect(screen.getByText(/REVENUE · THIS MONTH/)).toBeInTheDocument();
    });

    it('swaps the center metric when a segment is tapped (locked center-swap)', () => {
      render(<MoneyZone money={totals} />);
      // Tap the profit segment -> center shows profit.
      fireEvent.click(screen.getByTestId('money-seg-profit'));
      expect(screen.getByTestId('money-revenue').textContent).toBe('$8,500');
      // Tap the expenses segment -> center shows expenses.
      fireEvent.click(screen.getByTestId('money-seg-expenses'));
      expect(screen.getByTestId('money-revenue').textContent).toBe('$4,000');
      // Tapping the active segment again returns to revenue.
      fireEvent.click(screen.getByTestId('money-seg-expenses'));
      expect(screen.getByTestId('money-revenue').textContent).toBe('$12.5k');
    });

    it('swaps the center metric from the legend chip too', () => {
      render(<MoneyZone money={totals} />);
      fireEvent.click(screen.getByTestId('money-profit'));
      expect(screen.getByTestId('money-revenue').textContent).toBe('$8,500');
    });

    it('legend chips report the underlying figures', () => {
      render(<MoneyZone money={totals} />);
      expect(screen.getByTestId('money-expenses').textContent).toContain('$4,000');
      expect(screen.getByTestId('money-profit').textContent).toContain('$8,500');
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('no expenses -> hero number, no ring segments, no NaN arc', () => {
      const { container } = render(
        <MoneyZone money={{ ...totals, expenses_cents: 0, profit_cents: 1_250_000 }} />,
      );
      // Hero still shows revenue.
      expect(screen.getByTestId('money-revenue').textContent).toBe('$12.5k');
      // No ring segments at all in the no-expenses path.
      expect(screen.queryByTestId('money-seg-expenses')).toBeNull();
      expect(screen.queryByTestId('money-seg-profit')).toBeNull();
      // No dasharray anywhere contains NaN.
      container.querySelectorAll('circle').forEach(c => {
        expect(c.getAttribute('stroke-dasharray') ?? '').not.toContain('NaN');
      });
    });

    it('negative profit -> full expense arc, profit shown signed, no NaN', () => {
      // expenses ($15k) exceed revenue ($12.5k): profit = -$2.5k.
      const { container } = render(
        <MoneyZone money={{ ...totals, expenses_cents: 1_500_000, profit_cents: -250_000 }} />,
      );
      // Ring still renders both segment nodes.
      const expensesArc = screen.getByTestId('money-seg-expenses');
      const profitArc = screen.getByTestId('money-seg-profit');
      // Profit arc is clamped to zero length (no negative-length dash).
      const [profitDash] = (profitArc.getAttribute('stroke-dasharray') ?? '').split(' ');
      expect(Number(profitDash)).toBe(0);
      // Expense arc has a real, positive, finite length.
      const [expenseDash] = (expensesArc.getAttribute('stroke-dasharray') ?? '').split(' ');
      expect(Number(expenseDash)).toBeGreaterThan(0);
      expect(Number.isNaN(Number(expenseDash))).toBe(false);
      // Legend still surfaces the negative profit figure.
      expect(screen.getByTestId('money-profit').textContent).toContain('-2,500');
      // Nothing rendered a NaN dasharray.
      container.querySelectorAll('circle').forEach(c => {
        expect(c.getAttribute('stroke-dasharray') ?? '').not.toContain('NaN');
      });
    });
  });
});
