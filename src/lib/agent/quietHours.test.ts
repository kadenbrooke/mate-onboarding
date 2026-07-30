import { describe, it, expect } from 'vitest';
import { isWithinSendWindow, type QuietHours } from './quietHours';

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
