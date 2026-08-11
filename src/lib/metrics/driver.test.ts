import { describe, it, expect } from 'vitest';
import { driverSplit } from './driver';
import type { Lead } from './leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: null, city: null, service: null, phone: null,
  source: 'text', referrer_name: null, score: null, status: 'open', quote_cents: null,
  contacted: false, after_hours: false, first_reply_seconds: null,
  created_at: new Date().toISOString(), ...over,
});

describe('driverSplit', () => {
  it('counts human takeovers against agent-driven conversations', () => {
    const out = driverSplit([
      lead({ handler: 'agent' }), lead({ handler: 'agent' }),
      lead({ handler: 'agent' }), lead({ handler: 'human' }),
    ]);
    expect(out).toEqual({ agent: 3, human: 1, total: 4, agentPct: 75, humanPct: 25 });
  });

  it('treats a null or absent handler as agent (same default as the Driver pill)', () => {
    const out = driverSplit([lead({ handler: null }), lead({})]);
    expect(out.agent).toBe(2);
    expect(out.human).toBe(0);
  });

  it('reads 0/0 with no leads instead of dividing by zero', () => {
    expect(driverSplit([])).toEqual({ agent: 0, human: 0, total: 0, agentPct: 0, humanPct: 0 });
  });

  it('never lets the two percentages sum past 100 on a rounding split', () => {
    // 1 of 3 rounds to 33 and 2 of 3 rounds to 67: rounding both independently
    // would give 33 + 67 = 100 here but 33 + 33 = 66 elsewhere. Deriving one
    // from the other keeps the pair exact for any input.
    const out = driverSplit([lead({ handler: 'human' }), lead({}), lead({})]);
    expect(out.agentPct + out.humanPct).toBe(100);
    expect(out.agentPct).toBe(67);
  });
});
