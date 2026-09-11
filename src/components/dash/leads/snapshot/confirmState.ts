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
  /** The "Text them" switch. Off = save the lead for the client to work. */
  text: boolean;
  name: string;
  phone: string;
  address: string;
  service: string;
  notes: string;
  /** Fields the reader saw but was not sure of. They start blank and are highlighted. */
  withheld: ScoredField[];
  /** Set when this number already exists. The row is locked out entirely. */
  duplicate: DuplicateNote | null;
};

export function rowsFromCandidates(candidates: SnapshotCandidate[], duplicates: DuplicateNote[] = []): EditableRow[] {
  const dupByIndex = new Map(duplicates.map(d => [d.index, d]));
  return candidates.map((c, index) => {
    const duplicate = dupByIndex.get(index) ?? null;
    return {
      index,
      // A duplicate cannot be sent or saved, so it starts (and stays) off.
      include: duplicate === null,
      text: true,
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

/** An empty card for the typed-in flow. */
export function blankRow(index: number): EditableRow {
  return {
    index, include: true, text: true,
    name: '', phone: '', address: '', service: '', notes: '',
    withheld: [], duplicate: null,
  };
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

function liveRows(rows: EditableRow[]): EditableRow[] {
  return rows.filter(r => r.include && !r.duplicate && rowPhoneOk(r));
}

/** Rows that will be texted if the human taps the button. */
export function sendableRows(rows: EditableRow[]): EditableRow[] {
  return liveRows(rows).filter(r => r.text);
}

/** Rows that will be saved for the client to work, no text. */
export function savableRows(rows: EditableRow[]): EditableRow[] {
  return liveRows(rows).filter(r => !r.text);
}

export type SubmitState =
  | { ok: true; send: number; save: number }
  | { ok: false; send: number; save: number; reason: string };

/**
 * The gate on the button. At least one live row, no selected row with a
 * broken phone, and the consent box ticked IF anything will be texted. A
 * save-only batch needs no consent: nobody is being contacted.
 */
export function submitState(rows: EditableRow[], consent: boolean): SubmitState {
  const send = sendableRows(rows).length;
  const save = savableRows(rows).length;
  const includedButBroken = rows.filter(r => r.include && !r.duplicate && !rowPhoneOk(r)).length;
  if (send + save === 0) {
    return {
      ok: false, send, save,
      reason: includedButBroken > 0 ? 'Fix the phone number first.' : 'Nothing selected.',
    };
  }
  if (includedButBroken > 0) {
    return { ok: false, send, save, reason: 'One of the selected rows has a phone number that cannot be texted.' };
  }
  if (send > 0 && !consent) return { ok: false, send, save, reason: 'Confirm these people asked to be contacted.' };
  return { ok: true, send, save };
}

/** Says what will happen, not "Save". */
export function sendLabel(send: number, save: number): string {
  const texts = send === 1 ? 'Send 1 text' : `Send ${send} texts`;
  const leads = save === 1 ? 'Save 1 lead' : `Save ${save} leads`;
  if (send > 0 && save > 0) return `${texts}, save ${save}`;
  if (send > 0) return texts;
  if (save > 0) return leads;
  return 'Nothing to send';
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
