import { describe, it, expect } from 'vitest';
import {
  rollupKey, rollupEvents, mergeEvents, newestTimestamp, enteringKeys, MAX_HELD,
} from './tickerFeed';
import type { ClientEvent } from '@/lib/metrics/events';

let seq = 0;
const ev = (o: Partial<ClientEvent> = {}): ClientEvent => ({
  id: o.id ?? `e${seq++}`,
  agent: 'first_responder',
  kind: 'reply',
  message: o.message ?? 'Texted someone back',
  created_at: o.created_at ?? '2026-08-23T10:00:00.000Z',
  source_key: o.source_key,
});

const sms = (phone: string, at: string, extra: Partial<ClientEvent> = {}) =>
  ev({ ...extra, source_key: `jcsms:${phone}:out:${at}`, created_at: at });

describe('rollupKey', () => {
  it('groups SMS rows by the phone inside source_key', () => {
    expect(rollupKey(sms('+18015551234', '2026-08-23T10:00:00.000Z')))
      .toBe('phone:+18015551234');
  });

  it('leaves postcall and signal rows ungrouped, keyed by their own id', () => {
    expect(rollupKey(ev({ id: 'x1', source_key: 'postcall:abc:opened' }))).toBe('id:x1');
    expect(rollupKey(ev({ id: 'x2', source_key: 'signal:def' }))).toBe('id:x2');
  });

  it('falls back to the event id when source_key is absent', () => {
    expect(rollupKey(ev({ id: 'x3', source_key: null }))).toBe('id:x3');
    expect(rollupKey(ev({ id: 'x4' }))).toBe('id:x4');
  });

  it('does not group on a malformed jcsms key with no phone segment', () => {
    expect(rollupKey(ev({ id: 'x5', source_key: 'jcsms:' }))).toBe('id:x5');
  });
});

describe('rollupEvents', () => {
  it('collapses one lead into a single counted chip', () => {
    const groups = rollupEvents([
      sms('+1612', '2026-08-21T23:00:00.000Z'),
      sms('+1612', '2026-08-21T22:00:00.000Z'),
      sms('+1612', '2026-08-21T21:00:00.000Z'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });

  it('shows the newest message for a rolled-up lead', () => {
    const groups = rollupEvents([
      sms('+1612', '2026-08-21T21:00:00.000Z', { message: 'older' }),
      sms('+1612', '2026-08-21T23:00:00.000Z', { message: 'newest' }),
    ]);
    expect(groups[0].latest.message).toBe('newest');
  });

  it('positions a re-texted lead at the front, vacating its old slot', () => {
    const groups = rollupEvents([
      sms('+1001', '2026-08-20T10:00:00.000Z'),
      sms('+1002', '2026-08-21T10:00:00.000Z'),
      sms('+1003', '2026-08-22T10:00:00.000Z'),
      sms('+1001', '2026-08-23T10:00:00.000Z'), // the re-text
    ]);
    expect(groups.map(g => g.key)).toEqual(['phone:+1001', 'phone:+1003', 'phone:+1002']);
    expect(groups[0].count).toBe(2);
  });

  it('caps the strip at MAX_HELD chips', () => {
    const many = Array.from({ length: MAX_HELD + 10 }, (_, i) =>
      sms(`+${i}`, new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString()));
    expect(rollupEvents(many)).toHaveLength(MAX_HELD);
  });

  it('orders deterministically when timestamps tie', () => {
    const at = '2026-08-22T22:45:00.762Z';
    const once = rollupEvents([sms('+1003', at), sms('+1001', at), sms('+1002', at)]);
    const twice = rollupEvents([sms('+1002', at), sms('+1003', at), sms('+1001', at)]);
    expect(once.map(g => g.key)).toEqual(twice.map(g => g.key));
  });

  it('returns nothing for an empty feed', () => {
    expect(rollupEvents([])).toEqual([]);
  });
});

describe('mergeEvents', () => {
  it('returns the same reference when the batch is empty', () => {
    const current = [ev()];
    expect(mergeEvents(current, [])).toBe(current);
  });

  it('returns the same reference when every incoming row is already held', () => {
    const held = ev({ id: 'dup' });
    const current = [held];
    expect(mergeEvents(current, [held])).toBe(current);
  });

  it('prepends genuinely new events, newest first', () => {
    const older = ev({ id: 'old', created_at: '2026-08-22T10:00:00.000Z' });
    const newer = ev({ id: 'new', created_at: '2026-08-23T10:00:00.000Z' });
    expect(mergeEvents([older], [newer]).map(e => e.id)).toEqual(['new', 'old']);
  });

  it('keeps more raw rows than chips so rollup counts stay honest', () => {
    const rows = Array.from({ length: MAX_HELD * 10 }, (_, i) =>
      ev({ id: `r${i}`, created_at: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString() }));
    expect(mergeEvents([], rows).length).toBeGreaterThan(MAX_HELD);
  });
});

describe('newestTimestamp', () => {
  it('is null for an empty strip, so the poll does not fire', () => {
    expect(newestTimestamp([])).toBeNull();
  });

  it('finds the max regardless of array order', () => {
    expect(newestTimestamp([
      ev({ created_at: '2026-08-22T10:00:00.000Z' }),
      ev({ created_at: '2026-08-24T10:00:00.000Z' }),
      ev({ created_at: '2026-08-23T10:00:00.000Z' }),
    ])).toBe('2026-08-24T10:00:00.000Z');
  });
});

describe('enteringKeys', () => {
  it('flags only chips that were not there before', () => {
    const prev = rollupEvents([sms('+1001', '2026-08-22T10:00:00.000Z')]);
    const next = rollupEvents([
      sms('+1001', '2026-08-22T10:00:00.000Z'),
      sms('+1002', '2026-08-23T10:00:00.000Z'),
    ]);
    expect([...enteringKeys(prev, next)]).toEqual(['phone:+1002']);
  });

  it('does not flag a lead that merely moved to the front', () => {
    const prev = rollupEvents([
      sms('+1001', '2026-08-20T10:00:00.000Z'),
      sms('+1002', '2026-08-21T10:00:00.000Z'),
    ]);
    const next = rollupEvents([
      sms('+1001', '2026-08-20T10:00:00.000Z'),
      sms('+1002', '2026-08-21T10:00:00.000Z'),
      sms('+1001', '2026-08-23T10:00:00.000Z'),
    ]);
    expect(next[0].key).toBe('phone:+1001');
    expect(enteringKeys(prev, next).size).toBe(0);
  });
});
