import { describe, it, expect } from 'vitest';
import { fetchMoneyTotals, moneyTotals, type QbMetricRecord, type MoneyQuery } from './money';

function record(over: Partial<QbMetricRecord> = {}): QbMetricRecord {
  return {
    session_id: 'sess-A',
    period: '2026-07',
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    revenue_cents: 1_250_000,
    expenses_cents: 400_000,
    ar_cents: 320_000,
    invoices_outstanding: 4,
    collected_cents: 900_000,
    date_pulled: '2026-08-01',
    synced_at: '2026-08-01T13:00:00.000Z',
    ...over,
  };
}

/**
 * Fake Supabase query builder that captures the tenant filter and only ever
 * returns rows whose session_id matches the requested one -- exactly the RLS/
 * scoping contract the real service client + `.eq('session_id', ...)` provides.
 * If the code under test forgot to scope, the fake would hand back a foreign
 * row and the test would catch it.
 */
function fakeClient(rowsBySession: Record<string, QbMetricRecord>): {
  client: MoneyQuery;
  filters: { col: string; val: string }[];
} {
  const filters: { col: string; val: string }[] = [];
  const client: MoneyQuery = {
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => {
          filters.push({ col, val });
          return {
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: rowsBySession[val] ?? null, error: null }),
              }),
            }),
          };
        },
      }),
    }),
  };
  return { client, filters };
}

describe('fetchMoneyTotals tenant scoping', () => {
  it('scopes the read by session_id', async () => {
    const { client, filters } = fakeClient({ 'sess-A': record({ session_id: 'sess-A' }) });
    await fetchMoneyTotals(client, 'sess-A');
    expect(filters).toContainEqual({ col: 'session_id', val: 'sess-A' });
  });

  it("returns a client's own snapshot", async () => {
    const { client } = fakeClient({ 'sess-A': record({ session_id: 'sess-A', revenue_cents: 111 }) });
    const totals = await fetchMoneyTotals(client, 'sess-A');
    expect(totals?.revenue_cents).toBe(111);
  });

  it('cannot read another tenant: a different session sees none of A\'s money', async () => {
    // Store ONLY session A's row. B asks for its own data and must get null,
    // never A's financials. This is the cross-tenant leak class this dashboard
    // had a real incident over.
    const { client } = fakeClient({ 'sess-A': record({ session_id: 'sess-A', revenue_cents: 999_999 }) });
    const totals = await fetchMoneyTotals(client, 'sess-B');
    expect(totals).toBeNull();
  });

  it('defense in depth: a mismatched row that slips through is rejected', async () => {
    // Simulate a buggy/compromised query that returned a foreign row for B.
    // fetchMoneyTotals must still refuse it because row.session_id !== 'sess-B'.
    const { client } = fakeClient({ 'sess-B': record({ session_id: 'sess-A' }) });
    const totals = await fetchMoneyTotals(client, 'sess-B');
    expect(totals).toBeNull();
  });

  it('returns null (no snapshot) so the zone locks, when the session has no rows', async () => {
    const { client } = fakeClient({});
    expect(await fetchMoneyTotals(client, 'sess-A')).toBeNull();
  });
});

describe('moneyTotals shaping', () => {
  it('derives profit from revenue minus expenses', () => {
    const t = moneyTotals(record({ revenue_cents: 1_000_000, expenses_cents: 300_000 }));
    expect(t.profit_cents).toBe(700_000);
  });

  it('carries a negative profit through (expenses exceed revenue)', () => {
    const t = moneyTotals(record({ revenue_cents: 100_000, expenses_cents: 250_000 }));
    expect(t.profit_cents).toBe(-150_000);
  });

  it('passes AR, invoice count, and collections straight through', () => {
    const t = moneyTotals(record({ ar_cents: 320_000, invoices_outstanding: 4, collected_cents: 900_000 }));
    expect(t.ar_cents).toBe(320_000);
    expect(t.invoices_outstanding).toBe(4);
    expect(t.collected_cents).toBe(900_000);
  });
});
