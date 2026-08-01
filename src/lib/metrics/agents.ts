import type { ClientEvent } from './events';

// ---------------------------------------------------------------------------
// Agent Activity -- how much work each agent has actually done, trailing 30
// days. Answers the one question CrewRoster (live/locked status) can't: not
// just "is this agent on," but "is it doing anything." Deliberately just a
// count + last-active timestamp per agent, not a deeper efficiency metric --
// Reply Time already covers speed; this covers volume.
// ---------------------------------------------------------------------------

export type AgentKey = ClientEvent['agent'];

export type AgentActivity = { agent: AgentKey; count: number; lastActiveAt: string | null };

const WINDOW_DAYS = 30;

export function agentActivity(events: ClientEvent[], now = new Date()): AgentActivity[] {
  const cutoff = now.getTime() - WINDOW_DAYS * 86400_000;
  const byAgent = new Map<AgentKey, AgentActivity>();
  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    if (t < cutoff || t > now.getTime()) continue;
    const entry = byAgent.get(e.agent) ?? { agent: e.agent, count: 0, lastActiveAt: null };
    entry.count++;
    if (!entry.lastActiveAt || new Date(e.created_at) > new Date(entry.lastActiveAt)) {
      entry.lastActiveAt = e.created_at;
    }
    byAgent.set(e.agent, entry);
  }
  return [...byAgent.values()].sort((a, b) => b.count - a.count);
}
