import type { DashCapability } from '@/components/dash/types';

// The client's crew: which product agents exist, and which are actually live.
// Shared by the YOUR CREW card (which draws them) and the Month Overview's
// AGENTS ACTIVE tile (which counts them), so the two can never disagree about
// what "live" means.

/** The four agents that carry a client_capabilities row. Display order fixed.
 *  `aliases` are the capability_key values a backend row may legitimately use
 *  for this agent (the Phase 1 seed writes first_responder_sms). */
export const CREW_AGENTS: { key: string; label: string; aliases: string[] }[] = [
  { key: 'first_responder', label: 'First Responder', aliases: ['first_responder', 'first_responder_sms'] },
  { key: 'cultivator', label: 'Cultivator', aliases: ['cultivator'] },
  { key: 'reactivator', label: 'Reactivator', aliases: ['reactivator'] },
  {
    key: 'reputation_manager', label: 'Reputation Manager',
    aliases: ['reputation_manager', 'reputation_builder', 'reputation', 'gbp_reviews'],
  },
];

/** Auto Mate 5: the four above plus Command Center. The denominator on the
 *  AGENTS ACTIVE tile, fixed by the product, not by the client's data. */
export const AUTO_MATE_AGENT_COUNT = 5;

/** DB status values are 'live', 'demo', 'under_construction', 'complete'.
 *  Only 'live' (and 'active', forward-compat) counts as usable, matching
 *  capability.ts. */
function isLiveStatus(status: string): boolean {
  return status === 'live' || status === 'active';
}

/** True when one of this agent's capability rows says it is live. An agent with
 *  no row at all is never live. */
export function isAgentLive(aliases: string[], capabilities: DashCapability[]): boolean {
  return capabilities.some(c => aliases.includes(c.key) && isLiveStatus(c.status));
}

/**
 * How many of the five agents are running for this client.
 *
 * Command Center is counted as always-on: every client who can open the
 * dashboard is using it, and it has no capability row of its own. That is a
 * deliberate "for now" (founder call, 2026-08-11) -- if Command Center ever
 * becomes something a client can be without, give it a capability row and
 * delete the +1.
 */
export function activeAgentCount(capabilities: DashCapability[]): number {
  const live = CREW_AGENTS.filter(a => isAgentLive(a.aliases, capabilities)).length;
  return live + 1;
}
