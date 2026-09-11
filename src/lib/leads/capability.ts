// The Lead Snapshot capability gate.
//
// The feature is built generic and lit per client, so J&C being tenant #1 is a
// data fact, not a code fact. A client with no row does not have the feature.
//
// Deliberately NOT wired into crew.ts or AUTO_MATE_5: lead_snapshot is a
// dashboard feature, not a sixth agent. The gbp_reviews incident of 2026-08-25
// is the precedent, where a capability row lit an agent card and the assistant
// started claiming a capability the client did not have. See the regression
// test in crew.leadSnapshot.test.ts.

export const LEAD_SNAPSHOT_CAPABILITY = 'lead_snapshot';

export type CapabilityRow = { capability_key: string; status: string };

/**
 * Whether the client may upload snapshots.
 *
 * Only 'live' opens the door. 'under_construction' is the Phase B state, where
 * the code is deployed but the client must not see it yet, so it reads as off.
 */
export function isLeadSnapshotLive(rows: CapabilityRow[] | null | undefined): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some(r => r?.capability_key === LEAD_SNAPSHOT_CAPABILITY && r?.status === 'live');
}
