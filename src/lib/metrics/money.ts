// src/lib/metrics/money.ts
//
// Money zone: read + shape QBO financials for the dashboard. Pure shaping
// (moneyTotals) is separated from the tenant-scoped read (fetchMoneyTotals) so
// both unit-test in isolation. Money is whole cents throughout, matching the
// rest of the app; the component formats with moneyShort.

/** The columns the Money zone reads from qb_metrics. */
export type QbMetricRecord = {
  session_id: string;
  period: string;
  period_start: string | null;
  period_end: string | null;
  revenue_cents: number;
  expenses_cents: number;
  ar_cents: number;
  invoices_outstanding: number;
  collected_cents: number;
  date_pulled: string;
  synced_at: string;
};

/** Headline stats the Money zone renders. */
export type MoneyTotals = {
  revenue_cents: number;
  expenses_cents: number;
  profit_cents: number; // revenue - expenses
  ar_cents: number;
  invoices_outstanding: number;
  collected_cents: number;
  period: string;
  period_start: string | null;
  period_end: string | null;
  date_pulled: string;
};

/** Shape one qb_metrics row into zone totals. Profit is derived so the card
 *  never has to trust a separate stored value that could drift from revenue and
 *  expenses. */
export function moneyTotals(row: QbMetricRecord): MoneyTotals {
  return {
    revenue_cents: row.revenue_cents,
    expenses_cents: row.expenses_cents,
    profit_cents: row.revenue_cents - row.expenses_cents,
    ar_cents: row.ar_cents,
    invoices_outstanding: row.invoices_outstanding,
    collected_cents: row.collected_cents,
    period: row.period,
    period_start: row.period_start,
    period_end: row.period_end,
    date_pulled: row.date_pulled,
  };
}

/** Minimal shape of the query builder we depend on. A real Supabase client and
 *  the test's fake both satisfy it. Chainable, thenable via `maybeSingle`. */
export type MoneyQuery = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => {
            maybeSingle: () => Promise<{ data: QbMetricRecord | null; error: unknown }>;
          };
        };
      };
    };
  };
};

/**
 * Fetch the latest QBO snapshot for ONE session and shape it. TENANT ISOLATION:
 * the read is scoped `.eq('session_id', sessionId)` -- a session can only ever
 * read its own qb_metrics rows. This dashboard had a real cross-tenant
 * data-leak incident, so the scoping is asserted directly in money.test.ts, and
 * the caller (the /dash page) is auth-gated by requireDashAccess on top of this.
 *
 * Returns null when the session has no snapshot (which also drives the zone
 * lock, exactly like `ads === null` gates the Ad Performance zone).
 */
export async function fetchMoneyTotals(
  supabase: MoneyQuery,
  sessionId: string,
): Promise<MoneyTotals | null> {
  const { data, error } = await supabase
    .from('qb_metrics')
    .select(
      'session_id, period, period_start, period_end, revenue_cents, expenses_cents, ar_cents, invoices_outstanding, collected_cents, date_pulled, synced_at',
    )
    .eq('session_id', sessionId)
    .order('date_pulled', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  // Defense in depth: never shape a row that belongs to another session, even
  // if a query bug ever returned one.
  if (data.session_id !== sessionId) return null;
  return moneyTotals(data);
}
