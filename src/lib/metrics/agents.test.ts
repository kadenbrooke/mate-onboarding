import { describe, it, expect } from 'vitest';
import { agentActivity } from './agents';
import type { ClientEvent } from './events';

const event = (over: Partial<ClientEvent>): ClientEvent => ({
  id: Math.random().toString(),
  agent: 'first_responder',
  kind: 'missed_call_textback',
  message: 'test',
  created_at: new Date().toISOString(),
  ...over,
});

describe('agentActivity', () => {
  it('counts actions per agent within the trailing 30 days, ranked by count', () => {
    const rows = agentActivity([
      event({ agent: 'first_responder' }),
      event({ agent: 'first_responder' }),
      event({ agent: 'reactivator' }),
    ]);
    expect(rows[0]).toMatchObject({ agent: 'first_responder', count: 2 });
    expect(rows[1]).toMatchObject({ agent: 'reactivator', count: 1 });
  });

  it('excludes events older than 30 days', () => {
    const old = new Date(Date.now() - 40 * 86400_000).toISOString();
    const rows = agentActivity([event({ created_at: old })]);
    expect(rows).toHaveLength(0);
  });

  it('tracks the most recent created_at as lastActiveAt', () => {
    const earlier = new Date(Date.now() - 2 * 86400_000).toISOString();
    const later = new Date(Date.now() - 1 * 86400_000).toISOString();
    const rows = agentActivity([
      event({ agent: 'cultivator', created_at: earlier }),
      event({ agent: 'cultivator', created_at: later }),
    ]);
    expect(rows[0].lastActiveAt).toBe(later);
  });

  it('returns an empty array with no events', () => {
    expect(agentActivity([])).toEqual([]);
  });
});
