import type { DashCapability } from '@/components/dash/types';

// The client's crew: which product agents exist, and which are actually live.
// Shared by the YOUR CREW card (which draws them) and the Month Overview's
// AGENTS ACTIVE tile (which counts them), so the two can never disagree about
// what "live" means or how many agents there are.

export type CrewAgent = {
  key: string;
  label: string;
  /** capability_key values a backend row may legitimately use for this agent. */
  aliases: string[];
  /** Live for every client, with no capability row of its own. */
  alwaysLive?: boolean;
};

/** Auto Mate 5, display order fixed: the live ones first, then what is still
 *  to come. Product vocabulary, not internal codenames. */
export const CREW_AGENTS: CrewAgent[] = [
  { key: 'first_responder', label: 'First Responder', aliases: ['first_responder', 'first_responder_sms'] },
  { key: 'cultivator', label: 'Cultivator', aliases: ['cultivator'] },
  {
    // Command Center IS this dashboard: the operator console the client is
    // looking at. Every client who can open it is using it, so it is live by
    // definition and carries no capability row. If it ever becomes something a
    // client can be without, give it a row and drop alwaysLive.
    key: 'command_center', label: 'Command Center', aliases: ['command_center'], alwaysLive: true,
  },
  { key: 'reactivator', label: 'Reactivator', aliases: ['reactivator'] },
  {
    key: 'reputation_builder', label: 'Reputation Builder',
    aliases: ['reputation_builder', 'reputation_manager', 'reputation', 'gbp_reviews'],
  },
];

/** The denominator on the AGENTS ACTIVE tile. Derived from the roster itself so
 *  the tile can never disagree with the number of cards on the crew card. */
export const AUTO_MATE_AGENT_COUNT = CREW_AGENTS.length;

/** DB status values are 'live', 'demo', 'under_construction', 'complete'.
 *  Only 'live' (and 'active', forward-compat) counts as usable, matching
 *  capability.ts. */
function isLiveStatus(status: string): boolean {
  return status === 'live' || status === 'active';
}

/** True when the agent is always-on, or one of its capability rows says it is
 *  live. An agent with no row at all is never live. */
export function isAgentLive(agent: CrewAgent, capabilities: DashCapability[]): boolean {
  if (agent.alwaysLive) return true;
  return capabilities.some(c => agent.aliases.includes(c.key) && isLiveStatus(c.status));
}

/** How many of the five agents are running for this client. Same predicate the
 *  crew card draws with, so 3/5 on the tile always means three LIVE pills. */
export function activeAgentCount(capabilities: DashCapability[]): number {
  return CREW_AGENTS.filter(a => isAgentLive(a, capabilities)).length;
}
