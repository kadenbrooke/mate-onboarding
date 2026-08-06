import type { DashData } from '@/components/dash/types';
import type { ZoneId, ZoneLock } from './locks';

/**
 * Strip locked zones' data BEFORE it is handed to the client dashboard.
 *
 * SectionCard withholds a locked zone's children from the DOM, but that alone
 * does not keep the zone's data out of the RSC/Flight payload embedded in the
 * page HTML -- a locked zone's rows would otherwise be one "view source" away.
 * That is the exact real/synthetic data-exposure class this dashboard already
 * had a real incident over, so the true fix is server-side: a locked zone
 * contributes NOTHING to the payload.
 *
 * Only fields EXCLUSIVE to a gated zone are cleared. `events` is deliberately
 * kept: the Ticker, hero strip, and month overview are always-live surfaces
 * that read it, so it is not a locked-zone leak.
 *
 * Pure (no React, no Supabase) so page.tsx stays a thin caller and this gate is
 * unit-tested in isolation.
 */
export function gateLockedZoneData(
  data: DashData,
  locks: Record<ZoneId, ZoneLock | null>,
): DashData {
  const locked = (id: ZoneId) => locks[id] != null;
  return {
    ...data,
    // Calendar zone: appointments carry customer_name.
    appointments: locked('zone-calendar') ? [] : data.appointments,
    // Follow-up engine zone: reactivation pool + wins carry customer_name.
    reactivation: locked('zone-followup') ? null : data.reactivation,
    wins: locked('zone-followup') ? [] : data.wins,
    // Reputation zone: reviews carry author names; reputation carries the
    // aggregate rating/referral figures.
    reputation: locked('zone-reputation') ? null : data.reputation,
    reviews: locked('zone-reputation') ? [] : data.reviews,
    // Operations zone: crew roster / operator configuration.
    capabilities: locked('zone-operations') ? [] : data.capabilities,
    // Ad performance zone: `ads` is already null when locked (no ad_metrics
    // rows), but null it defensively so this gate is the single source of truth.
    ads: locked('zone-ads') ? null : data.ads,
  };
}
