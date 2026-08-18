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
    expect(out).toEqual({ agent: 3, human: 1, total: 4, agentPct: 75, humanPct: 25, windowed: false });
  });

  it('treats a null or absent handler as agent (same default as the Driver pill)', () => {
    const out = driverSplit([lead({ handler: null }), lead({})]);
    expect(out.agent).toBe(2);
    expect(out.human).toBe(0);
  });

  it('reads 0/0 with no leads instead of dividing by zero', () => {
    expect(driverSplit([])).toEqual({
      agent: 0, human: 0, total: 0, agentPct: 0, humanPct: 0, windowed: false,
    });
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

describe('driverSplit agent-live window', () => {
  const LIVE = '2026-07-30T00:38:51Z';
  const before = (n: number) => `2026-07-${String(n).padStart(2, '0')}T10:00:00Z`;
  const after = (n: number) => `2026-08-${String(n).padStart(2, '0')}T10:00:00Z`;

  it('excludes pre-agent leads so a human-handled backfill cannot drag the split', () => {
    // The J&C shape: a big historical backfill left at handler='human', plus a
    // handful of real post-launch conversations.
    const leads = [
      ...Array.from({ length: 8 }, (_, i) => lead({ handler: 'human', created_at: before(i + 1) })),
      lead({ handler: 'agent', created_at: after(1) }),
      lead({ handler: 'agent', created_at: after(2) }),
      lead({ handler: 'human', created_at: after(3) }),
    ];

    // All-time: the backfill dominates and the agent reads as barely working.
    expect(driverSplit(leads).agentPct).toBe(18);
    // Windowed: only conversations the agent could actually have driven.
    const windowed = driverSplit(leads, LIVE);
    expect(windowed.total).toBe(3);
    expect(windowed.agent).toBe(2);
    expect(windowed.human).toBe(1);
    expect(windowed.agentPct).toBe(67);
    expect(windowed.windowed).toBe(true);
  });

  it('counts a lead created exactly at the boundary as in-window', () => {
    const out = driverSplit([lead({ handler: 'agent', created_at: LIVE })], LIVE);
    expect(out.total).toBe(1);
  });

  it('scores every lead when since is null or unparseable', () => {
    const leads = [lead({ created_at: before(1) }), lead({ created_at: after(1) })];
    expect(driverSplit(leads, null).total).toBe(2);
    expect(driverSplit(leads, null).windowed).toBe(false);
    expect(driverSplit(leads, 'not-a-date').total).toBe(2);
  });

  it('reports an empty window rather than falling back to all-time', () => {
    const out = driverSplit([lead({ handler: 'human', created_at: before(1) })], LIVE);
    expect(out.total).toBe(0);
    expect(out.agentPct).toBe(0);
    expect(out.windowed).toBe(true);
  });
});
