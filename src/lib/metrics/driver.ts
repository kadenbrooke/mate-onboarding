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
  /** True when the split was narrowed to the agent-live window (see `since`). */
  windowed: boolean;
};

/**
 * `since` anchors the split to conversations the agent could actually have
 * driven: leads created on/after that instant, normally the session's own
 * created_at (when the client came online with us).
 *
 * Without it, any pre-agent history imported into client_leads is counted as
 * conversations the agent failed to handle. J&C is the live example: 84 of its
 * 101 rows are a deliberate historical backfill left at handler='human', which
 * dragged the card to 8% automated when the agent's real post-launch share is
 * 42%. Backfilled history is not agent performance.
 *
 * Omit `since` (or pass null) to score every lead, which is right for a session
 * whose leads all postdate the agent.
 */
export function driverSplit(leads: Lead[], since?: string | null): DriverSplit {
  const sinceMs = since ? new Date(since).getTime() : NaN;
  const windowed = !Number.isNaN(sinceMs);
  const scored = windowed
    ? leads.filter(l => new Date(l.created_at).getTime() >= sinceMs)
    : leads;

  let human = 0;
  for (const l of scored) if (l.handler === 'human') human++;
  const total = scored.length;
  const agent = total - human;
  // Round one side and derive the other, so the two never add up to 101.
  const agentPct = total === 0 ? 0 : Math.round((agent / total) * 100);
  return { agent, human, total, agentPct, humanPct: total === 0 ? 0 : 100 - agentPct, windowed };
}
