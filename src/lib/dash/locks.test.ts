import { describe, it, expect } from 'vitest';
import { zoneLocks, ALWAYS_LIVE_ZONES, GATED_ZONES } from './locks';

const ALL_CONNECTED = {
  sessionId: 's1',
  collected: { google_connected: true },
  agentEnabled: true,
  operatorPhone: '+18015551234',
  adsPresent: true,
};
const NOTHING_CONNECTED = {
  sessionId: 's1',
  collected: null,
  agentEnabled: false,
  operatorPhone: null,
  adsPresent: false,
};

describe('zoneLocks', () => {
  it('never locks the always-live zones, even with nothing connected', () => {
    const locks = zoneLocks(NOTHING_CONNECTED);
    for (const id of ALWAYS_LIVE_ZONES) {
      expect(locks[id]).toBeNull();
    }
  });

  it('locks every gated zone when nothing is connected', () => {
    const locks = zoneLocks(NOTHING_CONNECTED);
    for (const id of GATED_ZONES) {
      expect(locks[id], `${id} should be locked`).not.toBeNull();
    }
  });

  it('unlocks every zone when everything is connected', () => {
    const locks = zoneLocks(ALL_CONNECTED);
    expect(Object.values(locks).every((v) => v === null)).toBe(true);
  });

  it('unlocks calendar and reputation together on google_connected', () => {
    const locks = zoneLocks({ ...NOTHING_CONNECTED, collected: { google_connected: true } });
    expect(locks['zone-calendar']).toBeNull();
    expect(locks['zone-reputation']).toBeNull();
    expect(locks['zone-followup']).not.toBeNull();
  });

  it('treats a non-true google_connected value as not connected', () => {
    for (const value of [false, 'true', 1, null, undefined]) {
      const locks = zoneLocks({ ...NOTHING_CONNECTED, collected: { google_connected: value } });
      expect(locks['zone-calendar'], `google_connected=${String(value)}`).not.toBeNull();
    }
  });

  it('treats a blank operator phone as not set', () => {
    for (const value of ['', '   ', null]) {
      const locks = zoneLocks({ ...NOTHING_CONNECTED, operatorPhone: value });
      expect(locks['zone-operations']).not.toBeNull();
    }
  });

  it('unlocks ads on data presence, not on any client action', () => {
    const locks = zoneLocks({ ...NOTHING_CONNECTED, adsPresent: true });
    expect(locks['zone-ads']).toBeNull();
  });

  it('gives ads a secondary cta and the others a primary cta', () => {
    const locks = zoneLocks(NOTHING_CONNECTED);
    expect(locks['zone-ads']?.cta?.secondary).toBe(true);
    expect(locks['zone-calendar']?.cta?.secondary).toBeFalsy();
  });

  it('builds session-scoped cta links', () => {
    const locks = zoneLocks({ ...NOTHING_CONNECTED, sessionId: 'abc-123' });
    expect(locks['zone-calendar']?.cta?.href).toBe('/api/connect/google?sessionId=abc-123');
    expect(locks['zone-followup']?.cta?.href).toBe('/dash/abc-123/assistant');
  });

  it('uses no em dashes in any client-facing copy', () => {
    const locks = zoneLocks(NOTHING_CONNECTED);
    for (const lock of Object.values(locks)) {
      if (lock) expect(lock.reason).not.toContain('—');
    }
  });
});
