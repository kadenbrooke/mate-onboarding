// State logic for the Lead Snapshot confirm screen. Pure, so the rules that
// decide whether the Send button is live can be pinned by unit tests rather
// than clicked through by hand.

import type { SnapshotCandidate, ScoredField } from '@/lib/leads/snapshotParse';
import { toE164 } from '@/lib/leads/phone';
import { verdictMessage } from '@/lib/leads/confirmPlan';

export type DuplicateReason = 'in-pipeline' | 'in-conversation' | 'recent-contact';

export type DuplicateNote = { index: number; reason: DuplicateReason; lead_id: string | null };

export type EditableRow = {
  index: number;
  include: boolean;
  name: string;
  phone: string;
  address: string;
  service: string;
  notes: string;
  /** Fields the reader saw but was not sure of. They start blank and are highlighted. */
  withheld: ScoredField[];
  /** Set when this number already exists. The row is locked out of sending. */
  duplicate: DuplicateNote | null;
};

export function rowsFromCandidates(candidates: SnapshotCandidate[], duplicates: DuplicateNote[] = []): EditableRow[] {
  const dupByIndex = new Map(duplicates.map(d => [d.index, d]));
  return candidates.map((c, index) => {
    const duplicate = dupByIndex.get(index) ?? null;
    return {
      index,
      // A duplicate cannot be sent, so it starts (and stays) off.
      include: duplicate === null,
      name: c.name ?? '',
      phone: c.phone ?? '',
      address: c.address ?? '',
      service: c.service ?? '',
      notes: c.notes ?? '',
      withheld: c.withheld,
      duplicate,
    };
  });
}

export function updateRow(rows: EditableRow[], index: number, patch: Partial<EditableRow>): EditableRow[] {
  return rows.map(r => {
    if (r.index !== index) return r;
    // A duplicate stays excluded whatever the patch says.
    const next = { ...r, ...patch };
    if (next.duplicate) next.include = false;
    return next;
  });
}

/** Whether the phone as typed can be texted. */
export function rowPhoneOk(row: EditableRow): boolean {
  return toE164(row.phone).ok;
}

/** Rows that will actually be sent if the human taps the button. */
export function sendableRows(rows: EditableRow[]): EditableRow[] {
  return rows.filter(r => r.include && !r.duplicate && rowPhoneOk(r));
}

export type SubmitState = { ok: true; count: number } | { ok: false; count: number; reason: string };

/**
 * The gate on the Send button. Both halves must hold: at least one sendable
 * row, and the consent box ticked. The reason is shown next to the disabled
 * button so the human knows which half is missing.
 */
export function submitState(rows: EditableRow[], consent: boolean): SubmitState {
  const count = sendableRows(rows).length;
  const includedButBroken = rows.filter(r => r.include && !r.duplicate && !rowPhoneOk(r)).length;
  if (count === 0) {
    return {
      ok: false, count,
      reason: includedButBroken > 0 ? 'Fix the phone number first.' : 'Nothing selected to send.',
    };
  }
  if (includedButBroken > 0) {
    return { ok: false, count, reason: 'One of the selected rows has a phone number that cannot be texted.' };
  }
  if (!consent) return { ok: false, count, reason: 'Confirm these people asked to be contacted.' };
  return { ok: true, count };
}

/** Says what will happen, not "Save". */
export function sendLabel(count: number): string {
  return count === 1 ? 'Send 1 text' : `Send ${count} texts`;
}

export function duplicateMessage(d: DuplicateNote): string {
  return verdictMessage({ kind: 'duplicate', index: d.index, reason: d.reason, leadKey: '' });
}

/** "(801) 555-1234" for a 10 digit number, otherwise as typed. */
export function displayPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
