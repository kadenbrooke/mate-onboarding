import { describe, it, expect } from 'vitest';
import { monthOverview, monthRevenue } from './monthOverview';
import type { Lead } from './leads';
import type { ClientEvent } from './events';
import type { MoneyTotals } from './money';

// Minimal lead factory: only the fields monthOverview reads.
function lead(created_at: string, status: Lead['status'] = 'open', quote_cents = 0): Lead {
  return {
    id: created_at + status + Math.random(),
    name: 'T', city: null, service: null, source: 'web',
    referrer_name: null, score: 50, status, quote_cents,
    contacted: false, after_hours: false, first_reply_seconds: null,
    created_at,
  } as unknown as Lead;
}

const NOW = new Date('2026-08-12T12:00:00Z');

describe('monthOverview month-over-month spans', () => {
  it('compares month-to-date against the SAME elapsed span of the prior month', () => {
    const leads = [
      // 2 leads in the Aug 1-12 window
      lead('2026-08-03T10:00:00Z'),
      lead('2026-08-10T10:00:00Z'),
      // 2 leads in Jul 1-12 (inside the compared span)
      lead('2026-07-03T10:00:00Z'),
      lead('2026-07-10T10:00:00Z'),
      // 3 leads late in July: OUTSIDE the same-span window, must not count
      lead('2026-07-20T10:00:00Z'),
      lead('2026-07-25T10:00:00Z'),
      lead('2026-07-30T10:00:00Z'),
    ];
    const o = monthOverview(leads, [] as ClientEvent[], NOW);
    expect(o.leadsAcquired.value).toBe(2);
    // 2 vs 2, not 2 vs 5: a steady flow reads flat, not -60%.
    expect(o.leadsAcquired.pct).toBe(0);
  });

  it('applies the same span rule to jobs completed and calls handled', () => {
    const leads = [
      lead('2026-08-05T10:00:00Z', 'serviced', 1000),
      lead('2026-07-06T10:00:00Z', 'serviced', 1000),
      lead('2026-07-28T10:00:00Z', 'serviced', 1000), // outside span
    ];
    const events = [
      { id: 'e1', agent: 'fr', kind: 'call', message: '', created_at: '2026-08-04T10:00:00Z' },
      { id: 'e2', agent: 'fr', kind: 'call', message: '', created_at: '2026-07-04T10:00:00Z' },
      { id: 'e3', agent: 'fr', kind: 'call', message: '', created_at: '2026-07-29T10:00:00Z' }, // outside span
    ] as ClientEvent[];
    const o = monthOverview(leads, events, NOW);
    expect(o.jobsCompleted.value).toBe(1);
    expect(o.jobsCompleted.pct).toBe(0);
    expect(o.callsHandled.value).toBe(1);
    expect(o.callsHandled.pct).toBe(0);
  });
});

describe('monthOverview revenue is dated by service completion', () => {
  /** Serviced lead that ARRIVED and COMPLETED on different dates. */
  function servicedOn(created: string, completed: string | null, cents: number): Lead {
    return { ...lead(created, 'serviced', cents), status_updated_at: completed } as Lead;
  }

  it('books a June lead serviced in August as August revenue', () => {
    const o = monthOverview([servicedOn('2026-06-14T10:00:00Z', '2026-08-04T10:00:00Z', 500000)], [], NOW);
    expect(o.revenueEarned.value).toBe(500000);
    expect(o.jobsCompleted.value).toBe(1);
    // It did not arrive this month, so it is not a new lead this month.
    expect(o.leadsAcquired.value).toBe(0);
  });

  it('excludes an August lead that has not been serviced yet', () => {
    const o = monthOverview([lead('2026-08-04T10:00:00Z', 'quoted', 500000)], [], NOW);
    expect(o.revenueEarned.value).toBe(0);
    expect(o.jobsCompleted.value).toBe(0);
    expect(o.leadsAcquired.value).toBe(1);
  });

  it('excludes an August lead serviced next month from this month', () => {
    // Completion in the future relative to NOW: not yet this month's revenue.
    const o = monthOverview([servicedOn('2026-08-02T10:00:00Z', '2026-09-03T10:00:00Z', 400000)], [], NOW);
    expect(o.revenueEarned.value).toBe(0);
    expect(o.leadsAcquired.value).toBe(1);
  });

  it('compares against the prior month by completion date too', () => {
    const o = monthOverview([
      servicedOn('2026-05-01T10:00:00Z', '2026-08-04T10:00:00Z', 200000),
      servicedOn('2026-05-01T10:00:00Z', '2026-07-04T10:00:00Z', 100000),
    ], [], NOW);
    expect(o.revenueEarned.value).toBe(200000);
    expect(o.revenueEarned.pct).toBe(100); // 200000 vs 100000
  });

  it('dates a serviced row with no status stamp by created_at', () => {
    const o = monthOverview([servicedOn('2026-08-04T10:00:00Z', null, 300000)], [], NOW);
    expect(o.revenueEarned.value).toBe(300000);
  });

  it('keeps the service rate on the arrival cohort', () => {
    // Arrived and closed this month: 1 of 2 engaged leads from this cohort.
    const o = monthOverview([
      servicedOn('2026-08-02T10:00:00Z', '2026-08-05T10:00:00Z', 100000),
      lead('2026-08-03T10:00:00Z', 'quoted', 0),
      // An old lead completed this month adds revenue but is NOT part of this
      // month's cohort, so it must not inflate the conversion rate.
      servicedOn('2026-05-02T10:00:00Z', '2026-08-06T10:00:00Z', 900000),
    ], [], NOW);
    expect(o.serviceRatePct).toBe(50);
    expect(o.revenueEarned.value).toBe(1000000);
  });
});

describe('monthRevenue source selection', () => {
  const overview = monthOverview([lead('2026-08-04T10:00:00Z', 'serviced', 250000)], [], NOW);

  const qbo = (over: Partial<MoneyTotals> = {}): MoneyTotals => ({
    revenue_cents: 4_820_000, expenses_cents: 0, profit_cents: 4_820_000,
    ar_cents: 0, invoices_outstanding: 0, collected_cents: 0,
    period: '2026-08', period_start: '2026-08-01', period_end: '2026-08-31',
    date_pulled: '2026-08-12', ...over,
  });

  it('prefers QuickBooks and labels it with the period it covers', () => {
    const r = monthRevenue(overview, qbo());
    expect(r.source).toBe('quickbooks');
    expect(r.cents).toBe(4_820_000);
    expect(r.sourceLabel).toBe('from QuickBooks · August 2026');
  });

  it('labels a stale QuickBooks snapshot with its own period, not "this month"', () => {
    const r = monthRevenue(overview, qbo({ period: '2026-07', period_start: '2026-07-01' }));
    expect(r.sourceLabel).toBe('from QuickBooks · July 2026');
  });

  it('falls back to the serviced-lead sum and says it is pipeline-derived', () => {
    const r = monthRevenue(overview, null);
    expect(r.source).toBe('pipeline');
    expect(r.cents).toBe(250000);
    expect(r.sourceLabel).toMatch(/marked serviced/i);
    expect(r.sourceLabel).toMatch(/QuickBooks/i);
  });

  it('never reports the agent-attributed sum as QuickBooks revenue', () => {
    // The two numbers must stay distinguishable: the hero ROI card divides its
    // own (agent-attributed) figure by the retainer, so a QBO whole-business
    // number must never leak into it, and vice versa.
    expect(monthRevenue(overview, qbo()).cents).not.toBe(overview.revenueEarned.value);
  });
});
