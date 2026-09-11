import { describe, it, expect } from 'vitest';
import { planConfirm, verdictMessage, RECENT_CONTACT_DAYS, type ConfirmRow, type KnownNumbers } from './confirmPlan';

const row = (o: Partial<ConfirmRow> & { index: number }): ConfirmRow => ({
  include: true, name: 'Rynell Davis', phone: '801-577-5322', address: null, service: null, notes: null, ...o,
});
const empty = (): KnownNumbers => ({ leadKeys: new Set(), conversations: new Map() });
const NOW = new Date('2026-09-11T18:00:00Z');

describe('planConfirm', () => {
  it('sends a clean new row, normalised', () => {
    const [v] = planConfirm([row({ index: 0 })], empty(), NOW);
    expect(v.kind).toBe('send');
    if (v.kind !== 'send') return;
    expect(v.e164).toBe('+18015775322');
    expect(v.leadKey).toBe('8015775322');
    expect(v.lead.phone).toBe('+18015775322');
  });

  it('skips a row the human switched off', () => {
    expect(planConfirm([row({ index: 0, include: false })], empty(), NOW)[0])
      .toEqual({ kind: 'skipped', index: 0, reason: 'excluded' });
  });

  it('rejects an untextable phone with a readable reason', () => {
    const [v] = planConfirm([row({ index: 0, phone: '555-1234' })], empty(), NOW);
    expect(v.kind).toBe('invalid');
    if (v.kind === 'invalid') expect(v.reason).toMatch(/short/);
  });

  it('marks a number already in the pipeline as a duplicate', () => {
    const known = empty();
    known.leadKeys.add('8015775322');
    expect(planConfirm([row({ index: 0 })], known, NOW)[0])
      .toEqual({ kind: 'duplicate', index: 0, reason: 'in-pipeline', leadKey: '8015775322' });
  });

  it('matches the pipeline on lead_key, however the phone was written', () => {
    const known = empty();
    known.leadKeys.add('8015775322');
    for (const written of ['(801) 577-5322', '+1 801 577 5322', '18015775322']) {
      expect(planConfirm([row({ index: 0, phone: written })], known, NOW)[0].kind).toBe('duplicate');
    }
  });

  it('marks an open conversation as a duplicate', () => {
    const known = empty();
    known.conversations.set('+18015775322', { lastOutboundAt: '2026-01-01T00:00:00Z' });
    expect(planConfirm([row({ index: 0 })], known, NOW)[0])
      .toEqual({ kind: 'duplicate', index: 0, reason: 'in-conversation', leadKey: '8015775322' });
  });

  it('names a recent contact specifically', () => {
    const known = empty();
    known.conversations.set('+18015775322', { lastOutboundAt: '2026-09-10T18:00:00Z' });
    expect(planConfirm([row({ index: 0 })], known, NOW)[0])
      .toMatchObject({ kind: 'duplicate', reason: 'recent-contact' });
  });

  it('treats exactly the window edge as recent', () => {
    const known = empty();
    const edge = new Date(NOW.getTime() - RECENT_CONTACT_DAYS * 86400000).toISOString();
    known.conversations.set('+18015775322', { lastOutboundAt: edge });
    expect(planConfirm([row({ index: 0 })], known, NOW)[0]).toMatchObject({ reason: 'recent-contact' });
  });

  it('sends the same number only once when a photo lists it twice', () => {
    const verdicts = planConfirm(
      [row({ index: 0 }), row({ index: 1, phone: '(801) 577-5322' })],
      empty(), NOW,
    );
    expect(verdicts[0].kind).toBe('send');
    expect(verdicts[1]).toMatchObject({ kind: 'duplicate', reason: 'in-pipeline' });
  });

  it('refuses the client and operator numbers', () => {
    const [v] = planConfirm([row({ index: 0, phone: '+13854409882' })], empty(), NOW, new Set(['3854409882']));
    expect(v.kind).toBe('invalid');
    if (v.kind === 'invalid') expect(v.reason).toMatch(/own numbers/);
  });

  it('trims free text and blanks empties', () => {
    const [v] = planConfirm([row({ index: 0, name: '  Sam  ', address: '   ', service: 'seal_coat', notes: null })], empty(), NOW);
    if (v.kind !== 'send') throw new Error('expected send');
    expect(v.lead).toEqual({ name: 'Sam', phone: '+18015775322', address: null, service: 'seal_coat', notes: null });
  });

  it('preserves row order and index', () => {
    const verdicts = planConfirm([row({ index: 2 }), row({ index: 0, include: false }), row({ index: 1, phone: 'x' })], empty(), NOW);
    expect(verdicts.map(v => v.index)).toEqual([2, 0, 1]);
  });
});

describe('verdictMessage', () => {
  it('has plain copy for every verdict, no em dashes', () => {
    const all = planConfirm(
      [row({ index: 0 }), row({ index: 1, include: false }), row({ index: 2, phone: 'x' })],
      { leadKeys: new Set(), conversations: new Map() }, NOW,
    );
    for (const v of all) {
      const m = verdictMessage(v);
      expect(m.length).toBeGreaterThan(0);
      expect(m).not.toContain('—');
    }
    expect(verdictMessage({ kind: 'duplicate', index: 0, reason: 'recent-contact', leadKey: 'x' })).toContain(String(RECENT_CONTACT_DAYS));
  });
});
