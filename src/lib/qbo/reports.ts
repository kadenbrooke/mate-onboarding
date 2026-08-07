// src/lib/qbo/reports.ts
//
// Pure parsers: QBO API JSON -> the numbers the Money zone shows, in whole
// cents. No network. Three upstreams:
//   1. ProfitAndLoss report  -> revenue + expenses for the period
//   2. Invoice query         -> accounts receivable (open invoice balances)
//   3. Payment query         -> collected this month
//
// QBO returns money as decimal strings/numbers of dollars ("12345.67"); every
// column in this app is whole cents, so everything converts on the way in.

export function dollarsToCents(v: string | number | undefined | null): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// --- ProfitAndLoss report -------------------------------------------------
//
// The report is a nested tree: report.Rows.Row[] where each section Row has a
// `group` ("Income", "Expenses", "NetIncome", ...) and a `Summary.ColData[]`
// whose LAST cell holds the section total. We search the tree for the section
// by group name rather than assuming a fixed position, because QBO reorders and
// nests rows depending on the company's chart of accounts.

type ColData = { value?: string };
type Summary = { ColData?: ColData[] };
type ReportRow = {
  group?: string;
  Summary?: Summary;
  Rows?: { Row?: ReportRow[] };
};
export type ProfitAndLossReport = {
  Header?: { StartPeriod?: string; EndPeriod?: string };
  Rows?: { Row?: ReportRow[] };
};

/** Last numeric cell of a Summary row = the section total (dollars). */
function summaryTotal(row: ReportRow | undefined): number | null {
  const cols = row?.Summary?.ColData;
  if (!cols || cols.length === 0) return null;
  const last = cols[cols.length - 1]?.value;
  if (last == null || last === '') return null;
  const n = Number(last);
  return Number.isFinite(n) ? n : null;
}

/** Depth-first search for the section whose `group` matches, returning its
 *  Summary total in dollars. Returns null when the group is absent. */
function findGroupTotal(rows: ReportRow[] | undefined, group: string): number | null {
  if (!rows) return null;
  for (const row of rows) {
    if (row.group === group) {
      const t = summaryTotal(row);
      if (t != null) return t;
    }
    const nested = findGroupTotal(row.Rows?.Row, group);
    if (nested != null) return nested;
  }
  return null;
}

export type ProfitAndLossTotals = {
  revenue_cents: number;
  expenses_cents: number;
  period_start: string | null;
  period_end: string | null;
};

/**
 * Extract total income (revenue) and total expenses from a P&L report. Missing
 * sections read as 0 (a brand-new company with no expenses is a real 0, not an
 * error).
 */
export function parseProfitAndLoss(report: ProfitAndLossReport): ProfitAndLossTotals {
  const rows = report?.Rows?.Row;
  const revenue = findGroupTotal(rows, 'Income') ?? 0;
  const expenses = findGroupTotal(rows, 'Expenses') ?? 0;
  return {
    revenue_cents: dollarsToCents(revenue),
    expenses_cents: dollarsToCents(expenses),
    period_start: report?.Header?.StartPeriod ?? null,
    period_end: report?.Header?.EndPeriod ?? null,
  };
}

// --- Invoice query (accounts receivable) ----------------------------------

export type QboInvoice = { Balance?: string | number; TotalAmt?: string | number };
export type InvoiceQueryResponse = { QueryResponse?: { Invoice?: QboInvoice[] } };

export type ArTotals = { ar_cents: number; invoices_outstanding: number };

/**
 * Sum the outstanding balance across open invoices. The query should already
 * filter `Balance > 0`, but we also guard here so a broader query still yields
 * a correct AR figure (only positive balances count, and only those invoices
 * count toward the outstanding count).
 */
export function parseInvoicesOutstanding(resp: InvoiceQueryResponse): ArTotals {
  const invoices = resp?.QueryResponse?.Invoice ?? [];
  let ar_cents = 0;
  let count = 0;
  for (const inv of invoices) {
    const balance = dollarsToCents(inv.Balance);
    if (balance > 0) {
      ar_cents += balance;
      count += 1;
    }
  }
  return { ar_cents, invoices_outstanding: count };
}

// --- Payment query (collected this month) ---------------------------------

export type QboPayment = { TotalAmt?: string | number };
export type PaymentQueryResponse = { QueryResponse?: { Payment?: QboPayment[] } };

/** Sum payments received in the period. The query filters by TxnDate >= month
 *  start; this just totals the returned rows. */
export function parseCollected(resp: PaymentQueryResponse): number {
  const payments = resp?.QueryResponse?.Payment ?? [];
  return payments.reduce((a, p) => a + dollarsToCents(p.TotalAmt), 0);
}

// --- Assemble a qb_metrics row -------------------------------------------

export type QbMetricRow = {
  session_id: string;
  period: string; // YYYY-MM
  period_start: string | null;
  period_end: string | null;
  revenue_cents: number;
  expenses_cents: number;
  ar_cents: number;
  invoices_outstanding: number;
  collected_cents: number;
  date_pulled: string; // YYYY-MM-DD (UTC)
  raw: unknown;
  synced_at: string; // ISO
};

/** Compose the row the pull upserts into qb_metrics from the parsed pieces. */
export function buildQbMetricRow(input: {
  sessionId: string;
  period: string;
  datePulled: string;
  syncedAt?: string;
  pnl: ProfitAndLossTotals;
  ar: ArTotals;
  collected_cents: number;
  raw?: unknown;
}): QbMetricRow {
  return {
    session_id: input.sessionId,
    period: input.period,
    period_start: input.pnl.period_start,
    period_end: input.pnl.period_end,
    revenue_cents: input.pnl.revenue_cents,
    expenses_cents: input.pnl.expenses_cents,
    ar_cents: input.ar.ar_cents,
    invoices_outstanding: input.ar.invoices_outstanding,
    collected_cents: input.collected_cents,
    date_pulled: input.datePulled,
    raw: input.raw ?? {},
    synced_at: input.syncedAt ?? new Date().toISOString(),
  };
}
