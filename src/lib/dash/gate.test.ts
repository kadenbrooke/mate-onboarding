import { describe, it, expect } from 'vitest';
import { gateLockedZoneData } from './gate';
import { zoneLocks } from './locks';
import type { DashData } from '@/components/dash/types';

// A fully-populated data object: every gated zone carries real, PII-bearing
// rows so the test proves the gate empties them.
const FULL: DashData = {
  events: [{ id: 'e1', agent: 'a', kind: 'reply', message: 'hi', created_at: '2026-08-01' }] as never,
  appointments: [{ id: 'ap1', customer_name: 'Jane Real', service: 'Driveway', price_cents: 100000, starts_at: '2026-08-02' }] as never,
  reactivation: { pool_size: 12, contacted: 3, replied: 1, rebooked: 1, recovered_cents: 50000, dormancy_3_6mo: 1, dormancy_6_12mo: 1, dormancy_1_2yr: 1, dormancy_2yr_plus: 1 },
  wins: [{ id: 'w1', customer_name: 'Bob Real', dormant_months: 8, won_cents: 40000, state: 'won' }] as never,
  reputation: { jobs_done: 40, rate_asks: 20, rated_45: 15, on_google: 10, refer_asks: 8, referrals_in: 5, referrals_closed: 3, referrals_lost: 1, referral_revenue_cents: 90000, avg_rating: 4.7 },
  reviews: [{ id: 'r1', rating: 5, author: 'Carol Real', created_at: '2026-08-01' }] as never,
  capabilities: [{ key: 'sms', label: 'SMS', status: 'live' }],
  incidents: [],
  weekActionCount: 4,
  ads: null,
};

const ALL_LOCKED = zoneLocks({
  sessionId: 's1', collected: null, agentEnabled: false, operatorPhone: null, adsPresent: false,
});
const ALL_UNLOCKED = zoneLocks({
  sessionId: 's1', collected: { google_connected: true }, agentEnabled: true,
  operatorPhone: '+18015551234', adsPresent: true,
});

describe('gateLockedZoneData', () => {
  it('empties every locked zone field so nothing ships in the payload', () => {
    const gated = gateLockedZoneData(FULL, ALL_LOCKED);
    expect(gated.appointments).toEqual([]);   // calendar locked
    expect(gated.reactivation).toBeNull();     // follow-up locked
    expect(gated.wins).toEqual([]);            // follow-up locked
    expect(gated.reputation).toBeNull();       // reputation locked
    expect(gated.reviews).toEqual([]);         // reputation locked
    expect(gated.capabilities).toEqual([]);    // operations locked
    expect(gated.ads).toBeNull();              // ads locked
  });

  it('keeps events, incidents, and weekActionCount (always-live surfaces read them)', () => {
    const gated = gateLockedZoneData(FULL, ALL_LOCKED);
    expect(gated.events).toHaveLength(1);
    expect(gated.weekActionCount).toBe(4);
  });

  it('no PII from a locked zone survives into the payload', () => {
    const gated = gateLockedZoneData(FULL, ALL_LOCKED);
    const blob = JSON.stringify(gated);
    for (const name of ['Jane Real', 'Bob Real', 'Carol Real']) {
      expect(blob).not.toContain(name);
    }
  });

  it('passes every field through untouched when nothing is locked', () => {
    const gated = gateLockedZoneData(FULL, ALL_UNLOCKED);
    expect(gated.appointments).toHaveLength(1);
    expect(gated.wins).toHaveLength(1);
    expect(gated.reviews).toHaveLength(1);
    expect(gated.reputation).not.toBeNull();
    expect(gated.reactivation).not.toBeNull();
    expect(gated.capabilities).toHaveLength(1);
  });

  it('gates only the zones that are locked, leaving the rest intact', () => {
    // Only calendar locked (no google), everything else connected.
    const partial = zoneLocks({
      sessionId: 's1', collected: null, agentEnabled: true,
      operatorPhone: '+18015551234', adsPresent: true,
    });
    // collected null -> calendar AND reputation both gate on google_connected.
    const gated = gateLockedZoneData(FULL, partial);
    expect(gated.appointments).toEqual([]); // calendar locked
    expect(gated.reviews).toEqual([]);      // reputation locked (same google gate)
    expect(gated.wins).toHaveLength(1);     // follow-up unlocked (agent on)
    expect(gated.capabilities).toHaveLength(1); // operations unlocked (phone set)
  });
});
