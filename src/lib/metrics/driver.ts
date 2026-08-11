import type { Lead } from './leads';

// Manual vs. Automated: how many of this session's conversations the agent is
// driving versus how many a human took over. `client_leads.handler` IS the
// operator-takeover flag (set by the Driver pill, the postcall menu, and the
// LeadThread take-over control), so no new field is needed.
//
// A null/absent handler counts as 'agent', matching normalizeHandler in the
// pipeline table: legacy and demo rows predate the column and the agent is the
// default driver.

export type DriverSplit = {
  agent: number;
  human: number;
  total: number;
  /** Share of conversations the agent is driving, 0-100. 0 when there are none. */
  agentPct: number;
  /** Share a human took over, 0-100. Always agentPct's complement when total > 0. */
  humanPct: number;
};

export function driverSplit(leads: Lead[]): DriverSplit {
  let human = 0;
  for (const l of leads) if (l.handler === 'human') human++;
  const total = leads.length;
  const agent = total - human;
  // Round one side and derive the other, so the two never add up to 101.
  const agentPct = total === 0 ? 0 : Math.round((agent / total) * 100);
  return { agent, human, total, agentPct, humanPct: total === 0 ? 0 : 100 - agentPct };
}
