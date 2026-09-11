import { describe, it, expect } from 'vitest';
import { isLeadSnapshotLive, LEAD_SNAPSHOT_CAPABILITY } from './capability';
import { CREW_AGENTS, activeAgentCount, AUTO_MATE_AGENT_COUNT } from '@/lib/metrics/crew';
import { agentRoster, AUTO_MATE_5 } from '@/lib/portal/capabilities';
import type { DashCapability } from '@/components/dash/types';

describe('isLeadSnapshotLive', () => {
  it('opens only on a live row', () => {
    expect(isLeadSnapshotLive([{ capability_key: 'lead_snapshot', status: 'live' }])).toBe(true);
  });

  it('stays shut for under_construction, which is the Phase B state', () => {
    expect(isLeadSnapshotLive([{ capability_key: 'lead_snapshot', status: 'under_construction' }])).toBe(false);
  });

  it('stays shut when the client has no row at all', () => {
    expect(isLeadSnapshotLive([])).toBe(false);
    expect(isLeadSnapshotLive(null)).toBe(false);
    expect(isLeadSnapshotLive(undefined)).toBe(false);
  });

  it('is not opened by some other capability being live', () => {
    expect(isLeadSnapshotLive([{ capability_key: 'first_responder', status: 'live' }])).toBe(false);
  });

  it('survives malformed rows', () => {
    const rows = [null, undefined, {}, { capability_key: 'lead_snapshot', status: 'live' }];
    expect(isLeadSnapshotLive(rows as never)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression guard for spec open item 1: the gbp_reviews aliasing bug.
//
// On 2026-08-25 a capability row lit up an agent card, and the Mate assistant
// started telling a client it had a capability it did not have. lead_snapshot
// is a dashboard feature, not a sixth agent, so it must never reach the crew
// roster, the AGENTS ACTIVE tile, or the portal's agent cards.
// ---------------------------------------------------------------------------
describe('lead_snapshot is not an agent', () => {
  it('is claimed by no crew agent, under any alias', () => {
    for (const agent of CREW_AGENTS) {
      expect(agent.aliases).not.toContain(LEAD_SNAPSHOT_CAPABILITY);
    }
  });

  it('does not appear in the Auto Mate 5 roster', () => {
    expect(AUTO_MATE_5.map(a => a.key)).not.toContain(LEAD_SNAPSHOT_CAPABILITY);
    expect(CREW_AGENTS.map(a => a.key)).not.toContain(LEAD_SNAPSHOT_CAPABILITY);
  });

  it('does not raise the AGENTS ACTIVE count', () => {
    const without: DashCapability[] = [{ key: 'first_responder', label: 'First Responder', status: 'live' }];
    const withIt: DashCapability[] = [...without, { key: 'lead_snapshot', label: 'Lead Snapshot', status: 'live' }];
    expect(activeAgentCount(withIt)).toBe(activeAgentCount(without));
  });

  it('does not change the denominator either', () => {
    expect(AUTO_MATE_AGENT_COUNT).toBe(CREW_AGENTS.length);
  });

  it('lights no card in the portal agent roster', () => {
    const roster = agentRoster([{ capability_key: 'lead_snapshot', label: 'Lead Snapshot', status: 'live' }], []);
    expect(roster.every(card => card.status !== 'live')).toBe(true);
  });
});
