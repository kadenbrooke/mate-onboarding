// Decide what happens to each row the human confirmed, before anything sends.
//
// Pure. The route feeds it the edited rows plus what already exists for this
// session, and it hands back a per-row verdict. Every reason a row is NOT
// texted is named here so the result screen can say it in plain words and so
// a unit test can pin it.

import { toE164, phoneRejectionMessage } from './phone';

/** One row as the confirm screen sends it back. */
export type ConfirmRow = {
  /** Position in the extracted candidates array, for the audit record. */
  index: number;
  include: boolean;
  /**
   * The "Text them" switch. Off means save the lead for the client to work
   * themselves: pipeline row only, nothing automated. Absent reads as on, so
   * the photo flow's original payload keeps its meaning.
   */
  text?: boolean;
  name: string | null;
  phone: string | null;
  address: string | null;
  service: string | null;
  notes: string | null;
};

/** What the session already knows about a phone number. */
export type KnownNumbers = {
  /** lead_key values (last 10 digits) already in client_leads for this session. */
  leadKeys: Set<string>;
  /** E.164 numbers with an open conversation row, and when we last texted them. */
  conversations: Map<string, { lastOutboundAt: string | null }>;
};

export type SendMode = 'text' | 'save';

export type RowVerdict =
  | {
      kind: 'send';
      mode: SendMode;
      index: number;
      e164: string;
      leadKey: string;
      lead: { name: string | null; phone: string; address: string | null; service: string | null; notes: string | null };
    }
  | { kind: 'skipped'; index: number; reason: 'excluded' }
  | { kind: 'invalid'; index: number; reason: string }
  | { kind: 'duplicate'; index: number; reason: 'in-pipeline' | 'in-conversation' | 'recent-contact'; leadKey: string };

/** A number we texted inside this window is not texted again from a photo. */
export const RECENT_CONTACT_DAYS = 7;

export function planConfirm(
  rows: ConfirmRow[],
  known: KnownNumbers,
  now: Date = new Date(),
  blocked: Set<string> = new Set(),
): RowVerdict[] {
  const seenInBatch = new Set<string>();
  const recentCutoff = now.getTime() - RECENT_CONTACT_DAYS * 24 * 60 * 60 * 1000;

  return rows.map((row): RowVerdict => {
    if (!row.include) return { kind: 'skipped', index: row.index, reason: 'excluded' };

    const phone = toE164(row.phone);
    if (!phone.ok) return { kind: 'invalid', index: row.index, reason: phoneRejectionMessage(phone.reason) };

    // The client's own numbers and ours. trg_client_leads_block_operator does
    // this at the DB too, but a photo of the office whiteboard should fail
    // here with a readable reason, not as a trigger error three hops later.
    if (blocked.has(phone.leadKey)) {
      return { kind: 'invalid', index: row.index, reason: 'That is one of your own numbers.' };
    }

    // The same number twice in one batch lands once.
    if (seenInBatch.has(phone.leadKey)) {
      return { kind: 'duplicate', index: row.index, reason: 'in-pipeline', leadKey: phone.leadKey };
    }

    // Dedupe applies to BOTH modes. A saved-only row for a number that is
    // already in the pipeline would be a second row for the same person,
    // which is the actual harm, text or no text.
    const convo = known.conversations.get(phone.e164);
    if (convo) {
      const last = convo.lastOutboundAt ? new Date(convo.lastOutboundAt).getTime() : NaN;
      const recent = Number.isFinite(last) && last >= recentCutoff;
      return {
        kind: 'duplicate',
        index: row.index,
        reason: recent ? 'recent-contact' : 'in-conversation',
        leadKey: phone.leadKey,
      };
    }

    if (known.leadKeys.has(phone.leadKey)) {
      return { kind: 'duplicate', index: row.index, reason: 'in-pipeline', leadKey: phone.leadKey };
    }

    seenInBatch.add(phone.leadKey);
    return {
      kind: 'send',
      mode: row.text === false ? 'save' : 'text',
      index: row.index,
      e164: phone.e164,
      leadKey: phone.leadKey,
      lead: {
        name: clean(row.name),
        phone: phone.e164,
        address: clean(row.address),
        service: clean(row.service),
        notes: clean(row.notes),
      },
    };
  });
}

function clean(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t ? t : null;
}

/** Plain-language line for the result screen. */
export function verdictMessage(v: RowVerdict): string {
  switch (v.kind) {
    case 'send':
      return v.mode === 'text' ? 'Ready to send.' : 'Ready to save.';
    case 'skipped':
      return 'Left out.';
    case 'invalid':
      return v.reason;
    case 'duplicate':
      switch (v.reason) {
        case 'in-pipeline':
          return 'Already in your pipeline.';
        case 'in-conversation':
          return 'Already in a conversation with you.';
        case 'recent-contact':
          return `Texted in the last ${RECENT_CONTACT_DAYS} days. Not sending again.`;
      }
  }
}
