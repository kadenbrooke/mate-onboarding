import { describe, it, expect } from 'vitest';
import {
  parseProfitAndLoss,
  parseInvoicesOutstanding,
  parseCollected,
  buildQbMetricRow,
  dollarsToCents,
  type ProfitAndLossReport,
} from './reports';

// A trimmed but realistically-shaped QBO ProfitAndLoss report: nested sections
// each with a Summary whose last ColData cell is the section total (dollars).
const PNL: ProfitAndLossReport = {
  Header: { StartPeriod: '2026-07-01', EndPeriod: '2026-07-31' },
  Rows: {
    Row: [
      {
        group: 'Income',
        Rows: { Row: [{ Summary: { ColData: [{ value: 'Paving' }, { value: '10000.00' }] } }] },
        Summary: { ColData: [{ value: 'Total Income' }, { value: '12500.50' }] },
      },
      {
        group: 'Expenses',
        Summary: { ColData: [{ value: 'Total Expenses' }, { value: '4000.25' }] },
      },
      {
        group: 'NetIncome',
        Summary: { ColData: [{ value: 'Net Income' }, { value: '8500.25' }] },
      },
    ],
  },
};

describe('dollarsToCents', () => {
  it('rounds dollar strings and numbers to whole cents', () => {
    expect(dollarsToCents('12500.50')).toBe(1_250_050);
    expect(dollarsToCents(4000.25)).toBe(400_025);
    expect(dollarsToCents(undefined)).toBe(0);
    expect(dollarsToCents('not-money')).toBe(0);
  });
});

describe('parseProfitAndLoss', () => {
  it('pulls Total Income as revenue and Total Expenses, in cents', () => {
    const t = parseProfitAndLoss(PNL);
    expect(t.revenue_cents).toBe(1_250_050);
    expect(t.expenses_cents).toBe(400_025);
    expect(t.period_start).toBe('2026-07-01');
    expect(t.period_end).toBe('2026-07-31');
  });

  it('reads a missing Expenses section as 0 (new company, no expenses yet)', () => {
    const noExpenses: ProfitAndLossReport = {
      Rows: { Row: [{ group: 'Income', Summary: { ColData: [{ value: 'Total Income' }, { value: '500.00' }] } }] },
    };
    const t = parseProfitAndLoss(noExpenses);
    expect(t.revenue_cents).toBe(50_000);
    expect(t.expenses_cents).toBe(0);
  });

  it('does not crash on an empty report', () => {
    const t = parseProfitAndLoss({});
    expect(t.revenue_cents).toBe(0);
    expect(t.expenses_cents).toBe(0);
  });
});

describe('parseInvoicesOutstanding (accounts receivable)', () => {
  it('sums positive balances and counts only open invoices', () => {
    const resp = {
      QueryResponse: {
        Invoice: [
          { Balance: '1200.00', TotalAmt: '1200.00' },
          { Balance: 800.5, TotalAmt: 800.5 },
          { Balance: '0', TotalAmt: '500.00' }, // paid -> excluded
        ],
      },
    };
    const ar = parseInvoicesOutstanding(resp);
    expect(ar.ar_cents).toBe(200_050);
    expect(ar.invoices_outstanding).toBe(2);
  });

  it('is zero for no open invoices', () => {
    expect(parseInvoicesOutstanding({ QueryResponse: {} })).toEqual({ ar_cents: 0, invoices_outstanding: 0 });
    expect(parseInvoicesOutstanding({})).toEqual({ ar_cents: 0, invoices_outstanding: 0 });
  });
});

describe('parseCollected (payments this month)', () => {
  it('sums payment amounts in cents', () => {
    const resp = { QueryResponse: { Payment: [{ TotalAmt: '500.00' }, { TotalAmt: 250.25 }] } };
    expect(parseCollected(resp)).toBe(75_025);
  });

  it('is zero with no payments', () => {
    expect(parseCollected({})).toBe(0);
  });
});

describe('buildQbMetricRow', () => {
  it('assembles the upsert row from the parsed pieces', () => {
    const row = buildQbMetricRow({
      sessionId: 'sess-A',
      period: '2026-07',
      datePulled: '2026-08-01',
      syncedAt: '2026-08-01T13:00:00.000Z',
      pnl: parseProfitAndLoss(PNL),
      ar: { ar_cents: 200_050, invoices_outstanding: 2 },
      collected_cents: 75_025,
      raw: { source: 'test' },
    });
    expect(row).toMatchObject({
      session_id: 'sess-A',
      period: '2026-07',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      revenue_cents: 1_250_050,
      expenses_cents: 400_025,
      ar_cents: 200_050,
      invoices_outstanding: 2,
      collected_cents: 75_025,
      date_pulled: '2026-08-01',
      synced_at: '2026-08-01T13:00:00.000Z',
    });
  });
});
