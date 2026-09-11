import { describe, it, expect } from 'vitest';
import {
  rowsFromCandidates, updateRow, submitState, sendLabel, sendableRows, displayPhone, duplicateMessage,
} from './confirmState';
import type { SnapshotCandidate } from '@/lib/leads/snapshotParse';

const cand = (o: Partial<SnapshotCandidate> = {}): SnapshotCandidate => ({
  name: 'Rynell Davis', phone: '801-577-5322', address: null, service: null, notes: null,
  confidence: { name: 0.9, phone: 0.9, address: 0 }, withheld: [], ...o,
});

describe('rowsFromCandidates', () => {
  it('starts every readable row switched on', () => {
    const rows = rowsFromCandidates([cand(), cand({ phone: '801-555-0000' })]);
    expect(rows.every(r => r.include)).toBe(true);
  });

  it('starts a duplicate switched off and keeps it off', () => {
    const rows = rowsFromCandidates([cand()], [{ index: 0, reason: 'in-pipeline', lead_id: 'L1' }]);
    expect(rows[0].include).toBe(false);
    expect(rows[0].duplicate?.lead_id).toBe('L1');
    const flipped = updateRow(rows, 0, { include: true });
    expect(flipped[0].include).toBe(false);
  });

  it('leaves a withheld field blank rather than prefilled', () => {
    const rows = rowsFromCandidates([cand({ phone: null, withheld: ['phone'] })]);
    expect(rows[0].phone).toBe('');
    expect(rows[0].withheld).toEqual(['phone']);
  });
});

describe('submitState', () => {
  it('blocks until consent is ticked, even with a good row', () => {
    const rows = rowsFromCandidates([cand()]);
    expect(submitState(rows, false)).toEqual({ ok: false, count: 1, reason: 'Confirm these people asked to be contacted.' });
    expect(submitState(rows, true)).toEqual({ ok: true, count: 1 });
  });

  it('blocks when nothing is selected', () => {
    const rows = updateRow(rowsFromCandidates([cand()]), 0, { include: false });
    expect(submitState(rows, true)).toMatchObject({ ok: false, count: 0, reason: 'Nothing selected to send.' });
  });

  it('blocks on a bad phone and says so', () => {
    const rows = rowsFromCandidates([cand({ phone: '555-1234' })]);
    expect(submitState(rows, true)).toMatchObject({ ok: false, reason: 'Fix the phone number first.' });
  });

  it('blocks when one selected row is fine and another is broken', () => {
    const rows = rowsFromCandidates([cand(), cand({ phone: '12' })]);
    expect(submitState(rows, true)).toMatchObject({ ok: false, count: 1 });
  });

  it('does not count a duplicate toward the send count', () => {
    const rows = rowsFromCandidates([cand(), cand({ phone: '801-555-0000' })], [{ index: 1, reason: 'in-pipeline', lead_id: null }]);
    expect(submitState(rows, true)).toEqual({ ok: true, count: 1 });
    expect(sendableRows(rows).map(r => r.index)).toEqual([0]);
  });

  it('lets a switched-off broken row through', () => {
    const rows = updateRow(rowsFromCandidates([cand(), cand({ phone: '12' })]), 1, { include: false });
    expect(submitState(rows, true)).toEqual({ ok: true, count: 1 });
  });
});

describe('copy', () => {
  it('sendLabel says what will happen', () => {
    expect(sendLabel(1)).toBe('Send 1 text');
    expect(sendLabel(3)).toBe('Send 3 texts');
  });
  it('duplicateMessage is plain language', () => {
    expect(duplicateMessage({ index: 0, reason: 'in-pipeline', lead_id: null })).toBe('Already in your pipeline.');
    expect(duplicateMessage({ index: 0, reason: 'recent-contact', lead_id: null })).toMatch(/last 7 days/);
  });
  it('displayPhone formats a US number and leaves others alone', () => {
    expect(displayPhone('8015775322')).toBe('(801) 577-5322');
    expect(displayPhone('+18015775322')).toBe('(801) 577-5322');
    expect(displayPhone('+44 20 7183 8750')).toBe('+44 20 7183 8750');
    expect(displayPhone('')).toBe('');
  });
});
