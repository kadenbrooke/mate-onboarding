import { describe, it, expect } from 'vitest';
import {
  rowsFromCandidates, blankRow, updateRow, submitState, sendLabel, sendableRows, savableRows,
  displayPhone, duplicateMessage,
} from './confirmState';
import type { SnapshotCandidate } from '@/lib/leads/snapshotParse';

const cand = (o: Partial<SnapshotCandidate> = {}): SnapshotCandidate => ({
  name: 'Rynell Davis', phone: '801-577-5322', address: null, service: null, notes: null,
  confidence: { name: 0.9, phone: 0.9, address: 0 }, withheld: [], ...o,
});

describe('rowsFromCandidates', () => {
  it('starts every readable row switched on, with Text them on', () => {
    const rows = rowsFromCandidates([cand(), cand({ phone: '801-555-0000' })]);
    expect(rows.every(r => r.include && r.text)).toBe(true);
  });

  it('starts a duplicate switched off and keeps it off', () => {
    const rows = rowsFromCandidates([cand()], [{ index: 0, reason: 'in-pipeline', lead_id: 'L1' }]);
    expect(rows[0].include).toBe(false);
    expect(rows[0].duplicate?.lead_id).toBe('L1');
    expect(updateRow(rows, 0, { include: true })[0].include).toBe(false);
  });

  it('leaves a withheld field blank rather than prefilled', () => {
    const rows = rowsFromCandidates([cand({ phone: null, withheld: ['phone'] })]);
    expect(rows[0].phone).toBe('');
    expect(rows[0].withheld).toEqual(['phone']);
  });

  it('blankRow is an empty, included, texting card', () => {
    expect(blankRow(3)).toMatchObject({ index: 3, include: true, text: true, phone: '', duplicate: null });
  });
});

describe('submitState', () => {
  it('blocks a texting row until consent is ticked', () => {
    const rows = rowsFromCandidates([cand()]);
    expect(submitState(rows, false)).toEqual({ ok: false, send: 1, save: 0, reason: 'Confirm these people asked to be contacted.' });
    expect(submitState(rows, true)).toEqual({ ok: true, send: 1, save: 0 });
  });

  it('needs NO consent for a save-only batch: nobody is being contacted', () => {
    const rows = updateRow(rowsFromCandidates([cand()]), 0, { text: false });
    expect(submitState(rows, false)).toEqual({ ok: true, send: 0, save: 1 });
    expect(savableRows(rows)).toHaveLength(1);
    expect(sendableRows(rows)).toHaveLength(0);
  });

  it('a mixed batch still needs consent, because someone will be texted', () => {
    const rows = updateRow(rowsFromCandidates([cand(), cand({ phone: '801-555-0000' })]), 1, { text: false });
    expect(submitState(rows, false)).toMatchObject({ ok: false, send: 1, save: 1 });
    expect(submitState(rows, true)).toEqual({ ok: true, send: 1, save: 1 });
  });

  it('blocks when nothing is selected', () => {
    const rows = updateRow(rowsFromCandidates([cand()]), 0, { include: false });
    expect(submitState(rows, true)).toMatchObject({ ok: false, send: 0, save: 0, reason: 'Nothing selected.' });
  });

  it('blocks on a bad phone and says so, in either mode', () => {
    expect(submitState(rowsFromCandidates([cand({ phone: '555-1234' })]), true)).toMatchObject({ reason: 'Fix the phone number first.' });
    const saveOnly = updateRow(rowsFromCandidates([cand({ phone: '555-1234' })]), 0, { text: false });
    expect(submitState(saveOnly, true)).toMatchObject({ ok: false, reason: 'Fix the phone number first.' });
  });

  it('blocks when one selected row is fine and another is broken', () => {
    expect(submitState(rowsFromCandidates([cand(), cand({ phone: '12' })]), true)).toMatchObject({ ok: false, send: 1 });
  });

  it('counts neither mode for a duplicate', () => {
    const rows = rowsFromCandidates([cand(), cand({ phone: '801-555-0000' })], [{ index: 1, reason: 'in-pipeline', lead_id: null }]);
    expect(submitState(rows, true)).toEqual({ ok: true, send: 1, save: 0 });
  });

  it('lets a switched-off broken row through', () => {
    const rows = updateRow(rowsFromCandidates([cand(), cand({ phone: '12' })]), 1, { include: false });
    expect(submitState(rows, true)).toEqual({ ok: true, send: 1, save: 0 });
  });
});

describe('copy', () => {
  it('sendLabel says what will happen', () => {
    expect(sendLabel(1, 0)).toBe('Send 1 text');
    expect(sendLabel(3, 0)).toBe('Send 3 texts');
    expect(sendLabel(0, 1)).toBe('Save 1 lead');
    expect(sendLabel(0, 2)).toBe('Save 2 leads');
    expect(sendLabel(2, 1)).toBe('Send 2 texts, save 1');
    expect(sendLabel(0, 0)).toBe('Nothing to send');
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
