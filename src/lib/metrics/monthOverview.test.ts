import { describe, it, expect } from 'vitest';
import { monthOverview } from './monthOverview';
import type { Lead } from './leads';
import type { ClientEvent } from './events';

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
