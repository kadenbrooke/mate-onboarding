import type { ClientEvent } from './events';

// ---------------------------------------------------------------------------
// client_events, derived from the tables that actually record agent work.
//
// `client_events` was demo-only: every row in it belonged to the seeded demo
// session, so the five surfaces that read it (Ticker, Hours Saved, Calls
// Handled, Agent Activity, hero actions/hours sparklines) rendered zero for
// every real client while the demo looked alive.
//
// This module is the ONE place that decides, for a given source record, which
// agent gets credit, what `kind` the row carries, and how the line is worded.
// It is pure: no Supabase, no network, no clock. The write paths
// (/api/agent/postcall, /api/agent/signal) and the backfill script all call
// through here, so the ticker cannot drift between live and backfilled rows.
//
// `message` is CLIENT-FACING copy shown in the Ticker. Plain business English,
// no internal codenames, no em dashes (brand rule).
//
// Every mapper returns null rather than guessing when the source record does
// not describe a real, dateable agent action. A missing event is a smaller
// problem than an invented one.
//
// NOT mapped here on purpose:
//   * jc_sms_conversations.messages -- the JSONB turn array carries no
//     per-message timestamp, so per-message events cannot be honestly dated.
//     Only last_outbound_at is, and that mapping lives in the DB trigger
//     (migration 0013) because n8n writes that table, not this app. The
//     wording still originates here (SMS_OUTBOUND_MESSAGE_TEMPLATE) and a
//     test pins the migration to it.
//   * last_inbound_at -- a lead texting in is not agent work. Counting it
//     would inflate Hours Saved, which multiplies event count by minutes.
// ---------------------------------------------------------------------------

export type ClientEventInsert = {
  session_id: string;
  agent: ClientEvent['agent'];
  kind: string;
  message: string;
  created_at: string;
  /** Deterministic dedupe key. Unique index in migration 0013. */
  source_key: string;
};

/** The J&C tenant. jc_sms_conversations is single-tenant, same as 0010/0011. */
export const JC_SESSION_ID = '61400e73-0570-4167-88d9-d3a69650b15b';

/**
 * "+18018915463" -> "(801) 891-5463". Anything that is not a 10-digit US
 * number (with or without a leading 1) comes back unchanged: a mangled
 * best-effort format is worse than the raw string the client would recognise.
 */
export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw.trim() || null;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** How a lead is named in ticker copy: their name, else their number. */
export function describeLead(name?: string | null, phone?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return formatPhone(phone) ?? 'a new lead';
}

function iso(at: string | null | undefined): string | null {
  if (!at) return null;
  const t = new Date(at);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

// ---------------------------------------------------------------------------
// lead_postcall -- the operator menu the First Responder texts after a call
// ---------------------------------------------------------------------------

export type PostcallSource = {
  /** lead_postcall.id. */
  postcallId: string;
  sessionId: string | null | undefined;
  /** lead_postcall.kind: 'call' (post-call menu) or 'quote' (quote outcome). */
  kind?: string | null;
  leadName?: string | null;
  phone?: string | null;
};

/**
 * The menu was opened: a call ended and the agent immediately asked the office
 * what to do next.
 *
 * Deliberately NOT kind 'missed_call'. The voice workflow fires this on calls
 * that were HANDLED, so counting it as a missed call would both mislabel the
 * ticker line and hand RescueRing a denominator that is really its own
 * numerator in disguise, which is the exact bug the empty-state PR removed.
 */
export function postcallOpenedEvent(
  src: PostcallSource & { openedAt: string | null | undefined },
): ClientEventInsert | null {
  const at = iso(src.openedAt);
  if (!at || !src.sessionId) return null;
  // A quote menu opening is an internal question, not something the client's
  // business had happen. Only its OUTCOME is worth a ticker line.
  if ((src.kind ?? 'call') !== 'call') return null;
  return {
    session_id: src.sessionId,
    agent: 'first_responder',
    kind: 'call',
    message: `Checked in after your call with ${describeLead(src.leadName, src.phone)}`,
    created_at: at,
    source_key: `postcall:${src.postcallId}:opened`,
  };
}

/**
 * The operator answered the post-call menu and the agent acted on it.
 * Choice 4 ("you've got it handled") is intentionally silent: nothing was sent
 * and nobody was contacted, so there is no action to report.
 */
export function postcallResolvedEvent(
  src: PostcallSource & { resolvedAt: string | null | undefined; choice: string | null | undefined },
): ClientEventInsert | null {
  const at = iso(src.resolvedAt);
  if (!at || !src.sessionId) return null;
  if ((src.kind ?? 'call') !== 'call') return null;
  const who = describeLead(src.leadName, src.phone);
  const message =
    src.choice === '1' ? `Sent ${who} the onboarding form`
    : src.choice === '2' ? `Picked the conversation with ${who} back up`
    : src.choice === '3' ? `Sent ${who} answers to the common questions`
    : null;
  if (!message) return null;
  return {
    session_id: src.sessionId,
    agent: 'first_responder',
    kind: 'reply',
    message,
    created_at: at,
    source_key: `postcall:${src.postcallId}:resolved`,
  };
}

/**
 * The operator reported how an estimate went (J&C Cultivator quote menu).
 *
 * `won` / `lost` / `followup` are new kinds: the seeded vocabulary (reply,
 * missed_call, rebooked, review) has nothing that honestly covers a quote
 * outcome, and reusing `rebooked` (a reactivator concept) would be worse than
 * naming the thing. Nothing keys off `kind` except the missed-call denominator,
 * so these are additive.
 */
export function quoteOutcomeEvent(
  src: PostcallSource & { resolvedAt: string | null | undefined; choice: string | null | undefined },
): ClientEventInsert | null {
  const at = iso(src.resolvedAt);
  if (!at || !src.sessionId) return null;
  const who = describeLead(src.leadName, src.phone);
  const mapped =
    src.choice === '1' ? { kind: 'won', message: `The estimate for ${who} came back a win` }
    : src.choice === '2' ? { kind: 'followup', message: `${who} is still deciding, follow ups are running` }
    : src.choice === '3' ? { kind: 'lost', message: `${who} went another direction, closed it out` }
    : null;
  if (!mapped) return null;
  return {
    session_id: src.sessionId,
    agent: 'cultivator',
    kind: mapped.kind,
    message: mapped.message,
    created_at: at,
    source_key: `postcall:${src.postcallId}:quote`,
  };
}

// ---------------------------------------------------------------------------
// handoff_signals -- who is driving the conversation, the agent or the office
// ---------------------------------------------------------------------------

/**
 * Only signals that describe a real change of hands become ticker lines. The
 * table is also the sink for internal readiness pings from the e2e preview
 * page, and a client should never see one of those, so unknown kinds map to
 * null and the signal is still recorded.
 */
const HANDOFF_COPY: Record<string, string> = {
  operator_flip: 'Handed the conversation over to your team',
  handoff_to_operator: 'Handed the conversation over to your team',
  to_operator: 'Handed the conversation over to your team',
  back_to_agent: 'Picked the conversation back up from your team',
  agent_resume: 'Picked the conversation back up from your team',
};

export function handoffSignalEvent(src: {
  signalId: string | null | undefined;
  sessionId: string | null | undefined;
  kind: string | null | undefined;
  at: string | null | undefined;
}): ClientEventInsert | null {
  const at = iso(src.at);
  if (!at || !src.signalId || !src.sessionId || !src.kind) return null;
  const message = HANDOFF_COPY[src.kind];
  if (!message) return null;
  return {
    session_id: src.sessionId,
    agent: 'first_responder',
    kind: 'handoff',
    message,
    created_at: at,
    source_key: `signal:${src.signalId}`,
  };
}

// ---------------------------------------------------------------------------
// jc_sms_conversations -- the First Responder's own outbound texts
// ---------------------------------------------------------------------------

/**
 * Shared with the DB trigger in migration 0013, which renders it with SQL
 * `format()`. `eventSources.test.ts` reads the migration and fails if the two
 * ever drift, so this stays the single source of the wording.
 */
export const SMS_OUTBOUND_MESSAGE_TEMPLATE = 'Texted %s back';
export const UNKNOWN_LEAD_LABEL = 'a new lead';

export function smsOutboundMessage(who: string): string {
  return SMS_OUTBOUND_MESSAGE_TEMPLATE.replace('%s', who);
}

/**
 * One event per DISTINCT last_outbound_at.
 *
 * That timestamp is the only reliable record of the agent sending something:
 * the `messages` array it sits beside has no per-turn timestamps at all. Two
 * texts sent between two writes of the row therefore collapse into one event.
 * Undercounting is the honest failure here; the alternative is inventing
 * timestamps for turns nobody recorded.
 */
export function smsOutboundEvent(src: {
  sessionId?: string;
  fromNumber: string | null | undefined;
  leadName?: string | null;
  lastOutboundAt: string | null | undefined;
}): ClientEventInsert | null {
  const at = iso(src.lastOutboundAt);
  if (!at || !src.fromNumber) return null;
  return {
    session_id: src.sessionId ?? JC_SESSION_ID,
    agent: 'first_responder',
    kind: 'reply',
    message: smsOutboundMessage(describeLead(src.leadName, src.fromNumber)),
    created_at: at,
    source_key: `jcsms:${src.fromNumber}:out:${at}`,
  };
}
