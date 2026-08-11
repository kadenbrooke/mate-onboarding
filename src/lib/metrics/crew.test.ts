import { describe, it, expect } from 'vitest';
import { CREW_AGENTS, AUTO_MATE_AGENT_COUNT, isAgentLive, activeAgentCount } from './crew';
import type { DashCapability } from '@/components/dash/types';

const cap = (key: string, status: string): DashCapability => ({ key, label: key, status });

describe('crew roster', () => {
  it('carries the four capability-backed agents; Command Center is the fifth slot', () => {
    expect(CREW_AGENTS.map(a => a.key)).toEqual([
      'first_responder', 'cultivator', 'reactivator', 'reputation_manager',
    ]);
    expect(AUTO_MATE_AGENT_COUNT).toBe(5);
  });
});

describe('isAgentLive', () => {
  it('matches the legacy first_responder_sms capability key', () => {
    const fr = CREW_AGENTS[0];
    expect(isAgentLive(fr.aliases, [cap('first_responder_sms', 'live')])).toBe(true);
  });

  it('is false for a non-live status and for a missing row', () => {
    const fr = CREW_AGENTS[0];
    expect(isAgentLive(fr.aliases, [cap('first_responder', 'under_construction')])).toBe(false);
    expect(isAgentLive(fr.aliases, [])).toBe(false);
  });

  it('accepts "active" as well as "live"', () => {
    expect(isAgentLive(CREW_AGENTS[1].aliases, [cap('cultivator', 'active')])).toBe(true);
  });
});

describe('activeAgentCount', () => {
  it('counts live agents plus Command Center', () => {
    // J&C today: First Responder + Cultivator live, plus Command Center = 3.
    expect(activeAgentCount([
      cap('first_responder_sms', 'live'),
      cap('cultivator', 'live'),
      cap('gbp_reviews', 'under_construction'),
    ])).toBe(3);
  });

  it('is 1 (Command Center only) for a client with nothing live', () => {
    expect(activeAgentCount([])).toBe(1);
    expect(activeAgentCount([cap('first_responder_sms', 'under_construction')])).toBe(1);
  });

  it('never exceeds the roster size', () => {
    const all = CREW_AGENTS.map(a => cap(a.aliases[0], 'live'));
    expect(activeAgentCount(all)).toBe(AUTO_MATE_AGENT_COUNT);
  });
});
