import { describe, it, expect } from 'vitest';
import { CREW_AGENTS, AUTO_MATE_AGENT_COUNT, isAgentLive, activeAgentCount } from './crew';
import type { DashCapability } from '@/components/dash/types';

const cap = (key: string, status: string): DashCapability => ({ key, label: key, status });
const agent = (key: string) => CREW_AGENTS.find(a => a.key === key)!;

describe('crew roster', () => {
  it('is the Auto Mate 5, live ones first', () => {
    expect(CREW_AGENTS.map(a => a.key)).toEqual([
      'first_responder', 'cultivator', 'command_center', 'reactivator', 'reputation_builder',
    ]);
    expect(CREW_AGENTS.map(a => a.label)).toEqual([
      'First Responder', 'Cultivator', 'Command Center', 'Reactivator', 'Reputation Builder',
    ]);
  });

  it('derives the tile denominator from the roster so the two cannot drift', () => {
    expect(AUTO_MATE_AGENT_COUNT).toBe(CREW_AGENTS.length);
    expect(AUTO_MATE_AGENT_COUNT).toBe(5);
  });
});

describe('isAgentLive', () => {
  it('matches the legacy first_responder_sms capability key', () => {
    expect(isAgentLive(agent('first_responder'), [cap('first_responder_sms', 'live')])).toBe(true);
  });

  it('still matches the old reputation_manager key after the rename', () => {
    expect(isAgentLive(agent('reputation_builder'), [cap('reputation_manager', 'live')])).toBe(true);
  });

  it('is false for a non-live status and for a missing row', () => {
    expect(isAgentLive(agent('first_responder'), [cap('first_responder', 'under_construction')])).toBe(false);
    expect(isAgentLive(agent('first_responder'), [])).toBe(false);
  });

  it('accepts "active" as well as "live"', () => {
    expect(isAgentLive(agent('cultivator'), [cap('cultivator', 'active')])).toBe(true);
  });

  it('treats Command Center as live with no capability row at all', () => {
    expect(isAgentLive(agent('command_center'), [])).toBe(true);
  });
});

describe('activeAgentCount', () => {
  it('counts J&C today as 3: First Responder, Cultivator, Command Center', () => {
    expect(activeAgentCount([
      cap('first_responder_sms', 'live'),
      cap('cultivator', 'live'),
      cap('gbp_reviews', 'under_construction'),
    ])).toBe(3);
  });

  it('is 1 (Command Center only) for a client with nothing else live', () => {
    expect(activeAgentCount([])).toBe(1);
    expect(activeAgentCount([cap('first_responder_sms', 'under_construction')])).toBe(1);
  });

  it('never exceeds the roster size', () => {
    const all = CREW_AGENTS.map(a => cap(a.aliases[0], 'live'));
    expect(activeAgentCount(all)).toBe(AUTO_MATE_AGENT_COUNT);
  });

  it('agrees with the number of agents the crew card would draw as live', () => {
    const caps = [cap('first_responder_sms', 'live'), cap('cultivator', 'live')];
    const drawnLive = CREW_AGENTS.filter(a => isAgentLive(a, caps)).length;
    expect(activeAgentCount(caps)).toBe(drawnLive);
  });
});
