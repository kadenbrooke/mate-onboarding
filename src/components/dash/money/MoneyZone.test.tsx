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

  it('leads with revenue as the single top headline', () => {
    render(<MoneyZone money={totals} />);
    // moneyShort(1_250_000) -> "$12.5k"
    expect(screen.getByTestId('money-revenue').textContent).toBe('$12.5k');
    expect(screen.getByText(/REVENUE · THIS MONTH/)).toBeInTheDocument();
    // Revenue is NOT inside either ring center.
    expect(screen.getByTestId('money-pl-center').textContent).not.toBe('$12.5k');
    expect(screen.getByTestId('money-cash-center').textContent).not.toBe('$12.5k');
  });

  it('shows the period and last-updated footer', () => {
    render(<MoneyZone money={totals} />);
    expect(screen.getByText(/July 2026/)).toBeInTheDocument();
    expect(screen.getByText(/updated 2026-08-01/)).toBeInTheDocument();
  });

  // --- Ring 1: revenue = expenses + profit, always-visible legend ---

  describe('revenue ring (SourceDonut-style, no interaction)', () => {
    it('renders both ring segments', () => {
      render(<MoneyZone money={totals} />);
      expect(screen.getByTestId('money-seg-expenses')).toBeInTheDocument();
      expect(screen.getByTestId('money-seg-profit')).toBeInTheDocument();
    });

    it('spells out EXPENSES and PROFIT values in a persistent legend, no tap', () => {
      render(<MoneyZone money={totals} />);
      const expenses = screen.getByTestId('money-expenses');
      const profit = screen.getByTestId('money-profit');
      expect(expenses.textContent).toContain('EXPENSES');
      expect(expenses.textContent).toContain('$4,000');
      expect(profit.textContent).toContain('PROFIT');
      expect(profit.textContent).toContain('$8,500');
    });

    it('rests on PROFIT in the ring center', () => {
      render(<MoneyZone money={totals} />);
      // moneyShort(850_000) -> "$8,500"
      expect(screen.getByTestId('money-pl-center').textContent).toBe('$8,500');
    });

    it('no expenses -> headline only, no ring #1, no NaN arc', () => {
      const { container } = render(
        <MoneyZone money={{ ...totals, expenses_cents: 0, profit_cents: 1_250_000 }} />,
      );
      expect(screen.getByTestId('money-revenue').textContent).toBe('$12.5k');
      expect(screen.queryByTestId('money-seg-expenses')).toBeNull();
      expect(screen.queryByTestId('money-seg-profit')).toBeNull();
      // Ring #2 still present.
      expect(screen.getByTestId('money-cash-seg-collected')).toBeInTheDocument();
      container.querySelectorAll('circle').forEach(c => {
        expect(c.getAttribute('stroke-dasharray') ?? '').not.toContain('NaN');
      });
    });

    it('negative profit -> full expense arc, profit shown signed, no NaN', () => {
      render(
        <MoneyZone money={{ ...totals, expenses_cents: 1_500_000, profit_cents: -250_000 }} />,
      );
      const profitArc = screen.getByTestId('money-seg-profit');
      const expensesArc = screen.getByTestId('money-seg-expenses');
      const [profitDash] = (profitArc.getAttribute('stroke-dasharray') ?? '').split(' ');
      expect(Number(profitDash)).toBe(0);
      const [expenseDash] = (expensesArc.getAttribute('stroke-dasharray') ?? '').split(' ');
      expect(Number(expenseDash)).toBeGreaterThan(0);
      expect(Number.isNaN(Number(expenseDash))).toBe(false);
      // Signed profit visible in the legend and the center.
      expect(screen.getByTestId('money-profit').textContent).toContain('-2,500');
      expect(screen.getByTestId('money-pl-center').textContent).toContain('-2,500');
    });
  });

  // --- Ring 2: collected vs outstanding, always-visible legend (no sum) ---

  describe('cash-flow ring (SourceDonut-style, no interaction)', () => {
    it('renders both segments', () => {
      render(<MoneyZone money={totals} />);
      expect(screen.getByTestId('money-cash-seg-collected')).toBeInTheDocument();
      expect(screen.getByTestId('money-cash-seg-ar')).toBeInTheDocument();
    });

    it('spells out COLLECTED and OUTSTANDING values in a persistent legend, no tap', () => {
      render(<MoneyZone money={totals} />);
      const collected = screen.getByTestId('money-collected');
      const ar = screen.getByTestId('money-ar');
      expect(collected.textContent).toContain('COLLECTED');
      expect(collected.textContent).toContain('$9,000');
      expect(ar.textContent).toContain('OUTSTANDING');
      expect(ar.textContent).toContain('$3,200');
      // Invoice count surfaces as the outstanding sub -- still no interaction.
      expect(ar.textContent).toContain('4 invoices');
    });

    it('rests on COLLECTED in the ring center', () => {
      render(<MoneyZone money={totals} />);
      // moneyShort(900_000) -> "$9,000"
      expect(screen.getByTestId('money-cash-center').textContent).toBe('$9,000');
    });

    it('singularizes the invoice count', () => {
      render(<MoneyZone money={{ ...totals, invoices_outstanding: 1 }} />);
      expect(screen.getByTestId('money-ar').textContent).toContain('1 invoice');
    });

    it('NEVER shows collected + outstanding as a total (semantic guard)', () => {
      render(<MoneyZone money={totals} />);
      const center = screen.getByTestId('money-cash-center');
      // collected($9k) + ar($3.2k) = $12,200 -- must never appear as the center.
      expect(center.textContent).not.toContain('12,200');
      expect(center.textContent).toBe('$9,000');
    });

    it('outstanding = 0 -> full collected arc, no NaN', () => {
      const { container } = render(
        <MoneyZone money={{ ...totals, ar_cents: 0, invoices_outstanding: 0 }} />,
      );
      const [arDash] = (screen.getByTestId('money-cash-seg-ar').getAttribute('stroke-dasharray') ?? '').split(' ');
      const [collectedDash] = (screen.getByTestId('money-cash-seg-collected').getAttribute('stroke-dasharray') ?? '').split(' ');
      expect(Number(arDash)).toBe(0);
      expect(Number(collectedDash)).toBeGreaterThan(0);
      container.querySelectorAll('circle').forEach(c => {
        expect(c.getAttribute('stroke-dasharray') ?? '').not.toContain('NaN');
      });
    });

    it('collected = 0 -> full outstanding arc, no NaN', () => {
      render(<MoneyZone money={{ ...totals, collected_cents: 0 }} />);
      const [collectedDash] = (screen.getByTestId('money-cash-seg-collected').getAttribute('stroke-dasharray') ?? '').split(' ');
      const [arDash] = (screen.getByTestId('money-cash-seg-ar').getAttribute('stroke-dasharray') ?? '').split(' ');
      expect(Number(collectedDash)).toBe(0);
      expect(Number(arDash)).toBeGreaterThan(0);
      expect(screen.getByTestId('money-cash-center').textContent).toBe('$0');
    });

    it('both zero -> muted empty ring, $0 center, both cash arcs collapse, no NaN', () => {
      const { container } = render(
        <MoneyZone money={{ ...totals, collected_cents: 0, ar_cents: 0, invoices_outstanding: 0 }} />,
      );
      expect(screen.getByTestId('money-cash-center').textContent).toBe('$0');
      const [cDash] = (screen.getByTestId('money-cash-seg-collected').getAttribute('stroke-dasharray') ?? '').split(' ');
      const [aDash] = (screen.getByTestId('money-cash-seg-ar').getAttribute('stroke-dasharray') ?? '').split(' ');
      expect(Number(cDash)).toBe(0);
      expect(Number(aDash)).toBe(0);
      container.querySelectorAll('circle').forEach(c => {
        expect(c.getAttribute('stroke-dasharray') ?? '').not.toContain('NaN');
      });
    });
  });
});
