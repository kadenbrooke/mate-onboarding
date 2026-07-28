// src/lib/metrics/events.test.ts
import { describe, it, expect } from 'vitest';
import { actionsThisWeek, type ClientEvent } from './events';

const ev = (daysAgo: number): ClientEvent => ({
  id: Math.random().toString(), agent: 'first_responder', kind: 'reply',
  message: 'x', created_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
});

describe('actionsThisWeek', () => {
  it('counts events in the last 7 days only', () => {
    expect(actionsThisWeek([ev(0), ev(3), ev(10)])).toBe(2);
  });
});
