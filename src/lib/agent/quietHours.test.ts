import { describe, it, expect } from 'vitest';
import {
  isWithinSendWindow,
  nextSendWindowStart,
  DEFAULT_OUTREACH_HOURS,
  type QuietHours,
} from './quietHours';

const qh: QuietHours = { tz: 'America/Denver', start: '08:00', end: '20:00', skip_days: [0] };

describe('isWithinSendWindow', () => {
  it('allows a weekday mid-window time', () => {
    // 2026-07-29 is a Wednesday; 15:00 Denver == 21:00Z
    expect(isWithinSendWindow(qh, new Date('2026-07-29T21:00:00Z'))).toBe(true);
  });
  it('blocks before the window opens', () => {
    // 06:00 Denver == 12:00Z
    expect(isWithinSendWindow(qh, new Date('2026-07-29T12:00:00Z'))).toBe(false);
  });
  it('blocks after the window closes', () => {
    // 21:00 Denver == 03:00Z next day
    expect(isWithinSendWindow(qh, new Date('2026-07-30T03:00:00Z'))).toBe(false);
  });
  it('blocks a skip day (Sunday)', () => {
    // 2026-08-02 is a Sunday; 15:00 Denver == 21:00Z
    expect(isWithinSendWindow(qh, new Date('2026-08-02T21:00:00Z'))).toBe(false);
  });
  it('allows anytime when config is null', () => {
    expect(isWithinSendWindow(null, new Date('2026-08-02T09:00:00Z'))).toBe(true);
  });
});

// nextSendWindowStart is the Lead Snapshot release condition (migration 0017).
// A wrong answer here either drops a lead forever or texts a stranger at 2am,
// so the boundary cases are all pinned.
describe('nextSendWindowStart', () => {
  it('returns the instant unchanged when already inside the window', () => {
    // Wednesday 15:00 Denver
    const at = new Date('2026-07-29T21:00:00Z');
    expect(nextSendWindowStart(qh, at).toISOString()).toBe(at.toISOString());
  });

  it('holds an early-morning lead until 08:00 the same day', () => {
    // Wednesday 06:00 Denver -> Wednesday 08:00 Denver (14:00Z, MDT)
    expect(nextSendWindowStart(qh, new Date('2026-07-29T12:00:00Z')).toISOString())
      .toBe('2026-07-29T14:00:00.000Z');
  });

  it('rolls a late-evening lead to the next morning', () => {
    // Wednesday 21:00 Denver -> Thursday 08:00 Denver
    expect(nextSendWindowStart(qh, new Date('2026-07-30T03:00:00Z')).toISOString())
      .toBe('2026-07-30T14:00:00.000Z');
  });

  it('skips Sunday: a Saturday night lead waits for Monday', () => {
    // Saturday 2026-08-01 21:00 Denver -> Monday 2026-08-03 08:00 Denver
    expect(nextSendWindowStart(qh, new Date('2026-08-02T03:00:00Z')).toISOString())
      .toBe('2026-08-03T14:00:00.000Z');
  });

  it('skips Sunday from inside Sunday itself', () => {
    // Sunday 2026-08-02 12:00 Denver -> Monday 08:00 Denver
    expect(nextSendWindowStart(qh, new Date('2026-08-02T18:00:00Z')).toISOString())
      .toBe('2026-08-03T14:00:00.000Z');
  });

  it('holds correctly in winter, when Denver is MST not MDT', () => {
    // Wednesday 2026-01-14 06:00 MST (13:00Z) -> 08:00 MST (15:00Z)
    expect(nextSendWindowStart(qh, new Date('2026-01-14T13:00:00Z')).toISOString())
      .toBe('2026-01-14T15:00:00.000Z');
  });

  it('crosses a DST boundary without drifting an hour', () => {
    // DST starts Sunday 2026-03-08. Saturday 03-07 21:00 MST (04:00Z Sunday),
    // Sunday skipped, so it releases Monday 03-09 08:00 MDT == 14:00Z, not 15:00Z.
    expect(nextSendWindowStart(qh, new Date('2026-03-08T04:00:00Z')).toISOString())
      .toBe('2026-03-09T14:00:00.000Z');
  });

  it('never holds when there is no quiet-hours config', () => {
    const at = new Date('2026-08-02T09:00:00Z');
    expect(nextSendWindowStart(null, at).toISOString()).toBe(at.toISOString());
  });

  it('always returns an instant inside the window', () => {
    // Walk a full week in 30 minute steps; every answer must itself be sendable.
    for (let i = 0; i < 24 * 2 * 7; i += 1) {
      const at = new Date(Date.UTC(2026, 6, 27) + i * 30 * 60 * 1000);
      expect(isWithinSendWindow(qh, nextSendWindowStart(qh, at))).toBe(true);
    }
  });

  it('never moves an instant backwards', () => {
    for (let i = 0; i < 24 * 2 * 7; i += 1) {
      const at = new Date(Date.UTC(2026, 6, 27) + i * 30 * 60 * 1000);
      expect(nextSendWindowStart(qh, at).getTime()).toBeGreaterThanOrEqual(at.getTime());
    }
  });

  it('DEFAULT_OUTREACH_HOURS matches the gate the drip already uses', () => {
    expect(DEFAULT_OUTREACH_HOURS).toEqual({
      tz: 'America/Denver', start: '08:00', end: '20:00', skip_days: [0],
    });
  });
});
