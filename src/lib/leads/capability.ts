// The Lead Snapshot capability gate.
//
// The feature is built generic and lit per client, so J&C being tenant #1 is a
// data fact, not a code fact. A client with no row does not have the feature.
//
// Deliberately NOT wired into crew.ts or AUTO_MATE_5: lead_snapshot is a
// dashboard feature, not a sixth agent. The gbp_reviews incident of 2026-08-25
// is the precedent, where a capability row lit an agent card and the assistant
// started claiming a capability the client did not have. See the regression
// test in capability.test.ts.

import type { DashAccess } from '@/lib/portal/dash-access';

export const LEAD_SNAPSHOT_CAPABILITY = 'lead_snapshot';

export type CapabilityRow = { capability_key: string; status: string };

function statusOf(rows: CapabilityRow[] | null | undefined): string | null {
  if (!Array.isArray(rows)) return null;
  return rows.find(r => r?.capability_key === LEAD_SNAPSHOT_CAPABILITY)?.status ?? null;
}

/** 'live' for this client. The client-facing answer. */
export function isLeadSnapshotLive(rows: CapabilityRow[] | null | undefined): boolean {
  return statusOf(rows) === 'live';
}

/**
 * Whether THIS caller may use Lead Snapshot on this dashboard.
 *
 *   live                 -> every member and every internal user
 *   under_construction   -> internal users only (Auto Mate staff, portal_access
 *                           'mate'), so the founder can run own-number probes
 *                           on the real path while the client still sees nothing
 *   anything else / none -> nobody
 *
 * This is what the spec's rollout table means by "capability under_construction,
 * founder-number probes only" for Phase B. A member of the client's session is
 * never let through on under_construction, whatever else is true.
 */
export function canUseLeadSnapshot(rows: CapabilityRow[] | null | undefined, access: DashAccess): boolean {
  const status = statusOf(rows);
  if (status === 'live') return access === 'member' || access === 'internal';
  if (status === 'under_construction') return access === 'internal';
  return false;
}
