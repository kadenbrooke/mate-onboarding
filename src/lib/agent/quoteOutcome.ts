import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostcallChoice } from './postcall';

// Quote-outcome operator menu for the J&C Cultivator. Reuses the post-call
// system (classifyReply parses the leading 1-4 + notes); this module owns only
// the quote-specific side effects on jc_sms_conversations. cultivator-spec.md Piece 3.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The menu texted to the operator (Jeffrey) after a quote/estimate appointment. */
export function buildQuoteOutcomeMenu(): string {
  // No em dash (brand rule). Semantics match the spec's 1/2/3/4.
  return 'How did the meeting go? 1. Won 2. Thinking 3. Lost 4. Ignore. Feel free to add notes.';
}

export type QuoteOutcomeDeps = {
  conversationId: string;
  supabase: SupabaseClient;
  now?: () => Date;
  /** Sink for operator notes. The route wires this to append onto the lead_postcall row. */
  logNote?: (note: string) => Promise<void>;
};

/**
 * Apply the operator's quote-outcome choice to the jc_sms_conversations row.
 *
 *   1 Won      -> status=won,           won_at=now,  campaign=none
 *   2 Thinking -> status=quoted_thinking, campaign=post_quote, nurture_stage=0,
 *                 next_drip_due_at=now+1d  (Drip B starts)
 *   3 Lost     -> status=lost,          lost_at=now, campaign=none
 *   4 Ignore   -> no state change (the route schedules one re-ask ~24h later)
 *
 * Notes, when present, are always logged via deps.logNote regardless of choice.
 * Returns the applied patch (empty for choice 4) for observability/testing.
 */
export async function applyQuoteOutcome(
  choice: PostcallChoice,
  notes: string | null,
  deps: QuoteOutcomeDeps,
): Promise<{ patch: Record<string, unknown> }> {
  const { conversationId, supabase, now = () => new Date(), logNote } = deps;
  const ts = now().toISOString();

  let patch: Record<string, unknown> = {};
  switch (choice) {
    case '1':
      patch = { status: 'won', won_at: ts, campaign: 'none' };
      break;
    case '2':
      patch = {
        status: 'quoted_thinking',
        campaign: 'post_quote',
        nurture_stage: 0,
        next_drip_due_at: new Date(now().getTime() + DAY_MS).toISOString(),
      };
      break;
    case '3':
      patch = { status: 'lost', lost_at: ts, campaign: 'none' };
      break;
    case '4':
    default:
      patch = {};
      break;
  }

  if (Object.keys(patch).length > 0) {
    // jc_sms_conversations has no `id`; its natural key is from_number (text).
    // conversationId carries that from_number end-to-end (see runQuoteMenuScan).
    await supabase.from('jc_sms_conversations').update(patch).eq('from_number', conversationId);
  }
  if (notes && logNote) {
    await logNote(notes);
  }
  return { patch };
}

export type QuoteScanDeps = {
  supabase: SupabaseClient;
  sendSms: (to: string, text: string) => Promise<{ ok: boolean }>;
  sessionId: string;
  operatorPhone: string;
  /** False = inside quiet hours; defer this cycle rather than texting the operator. */
  withinWindow: boolean;
  now?: () => Date;
};

/**
 * Trigger side of the quote menu. Two jobs, both quiet-hours gated:
 *  1. Open a menu for every conversation whose quote appointment has ended and is
 *     still `quote_booked` (skip any that already have an open quote menu).
 *  2. Re-send once for any open quote menu whose `reask_at` has passed (choice 4),
 *     then clear reask_at so it stops.
 * Meant to be called on a schedule (n8n Schedule Trigger -> the quote-scan route).
 */
export async function runQuoteMenuScan(
  deps: QuoteScanDeps,
): Promise<{ opened: number; reasked: number; deferred: boolean }> {
  const { supabase, sendSms, sessionId, operatorPhone, withinWindow, now = () => new Date() } = deps;
  if (!withinWindow) return { opened: 0, reasked: 0, deferred: true };
  const nowIso = now().toISOString();

  // 1. Newly-due quote appointments -> open a menu.
  // jc_sms_conversations has no `id`; its natural key is from_number (text), so we
  // select and carry from_number as the conversation identifier throughout.
  const { data: due } = await supabase
    .from('jc_sms_conversations')
    .select('from_number')
    .eq('status', 'quote_booked')
    .lte('quote_appt_end_at', nowIso);
  let opened = 0;
  for (const conv of (due ?? []) as Array<{ from_number: string }>) {
    const { data: existing } = await supabase
      .from('lead_postcall')
      .select('id')
      .eq('jc_conversation_id', conv.from_number)
      .eq('kind', 'quote')
      .eq('status', 'awaiting')
      .maybeSingle();
    if (existing) continue;
    await supabase.from('lead_postcall').insert({
      session_id: sessionId,
      jc_conversation_id: conv.from_number,
      kind: 'quote',
      status: 'awaiting',
    });
    await sendSms(operatorPhone, buildQuoteOutcomeMenu());
    opened++;
  }

  // 2. Due re-asks (choice 4) -> re-send once, then clear reask_at.
  const { data: reask } = await supabase
    .from('lead_postcall')
    .select('id')
    .eq('kind', 'quote')
    .eq('status', 'awaiting')
    .not('reask_at', 'is', null)
    .lte('reask_at', nowIso);
  let reasked = 0;
  for (const r of (reask ?? []) as Array<{ id: string }>) {
    await sendSms(operatorPhone, buildQuoteOutcomeMenu());
    await supabase.from('lead_postcall').update({ reask_at: null }).eq('id', r.id);
    reasked++;
  }

  return { opened, reasked, deferred: false };
}
