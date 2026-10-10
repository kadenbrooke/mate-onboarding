// src/lib/command/commandCenter.ts
//
// The owner's Command Center (Auto Mate 5 #5): the one screen J&C's owner
// opens in the morning and between jobs. Four questions, answered from data
// Mate already has, no new tables:
//
//   1. Who do I call right now?   callList   (live score, migration 0020)
//   2. What is waiting on me?      waitingOnMe (new, replied, handed to a person)
//   3. What is on the books?       booksSummary (job outcomes + payments, 0021)
//   4. What is stuck?              stuckList  (quotes gone quiet, money owed)
//
// Everything here is pure (no Supabase, no clock unless passed), so the rules
// for "what counts as waiting" and "what counts as stuck" are unit-tested in
// commandCenter.test.ts. The page (app/dash/[sessionId]/command) only fetches
// and hands the rows in.
//
// The partner revenue-share basis is deliberately NOT part of this model: the
// Command Center is a client-facing screen and that figure is internal-only.

import { scoreStats, isServiced, type Lead } from '@/lib/metrics/leads';
import type { ReturnSummary } from '@/lib/metrics/revenue';
import { urgencyFor } from '@/lib/metrics/leadScore';
import { moneyShort } from '@/lib/metrics/format';
import { filterOptedOutLeads } from '@/lib/leads/doNotContact';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A lead counts as new for this long after it arrives. */
export const NEW_WINDOW_HOURS = 24;
/** A lead the agent is handling shows as "replied" for this long after it texts back. */
export const REPLY_WINDOW_HOURS = 24;
/** A lead just handed to a person shows for this long even before it texts again. */
export const HANDOFF_FRESH_HOURS = 48;
/** A quote with no won/lost after this many days is stuck. */
export const QUOTE_STALE_DAYS = 14;
/** A quote at or above this shows its value as a reason to call. */
export const BIG_QUOTE_CENTS = 500_000;

/** One row of client_lead_scores (migration 0020), the columns this screen reads. */
export type LeadSignal = {
  lead_id: string;
  score: number | null;
  tier: string | null;
  timeframe: string | null;
  last_lead_reply_at: string | null;
};

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** A lead is closed for this screen once the job is done or marked won/lost. */
export function isClosed(l: Lead): boolean {
  return isServiced(l) || l.job_outcome === 'won' || l.job_outcome === 'lost';
}

/** "now", "5m", "3h", "2d", "6w". Future times read as "now". */
export function ago(iso: string, now: Date): string {
  const t = ms(iso);
  if (t == null) return '';
  const d = now.getTime() - t;
  if (d < 60_000) return 'now';
  if (d < HOUR_MS) return `${Math.floor(d / 60_000)}m`;
  if (d < DAY_MS) return `${Math.floor(d / HOUR_MS)}h`;
  if (d < 14 * DAY_MS) return `${Math.floor(d / DAY_MS)}d`;
  return `${Math.floor(d / (7 * DAY_MS))}w`;
}

/**
 * A tel: link for a US number, or null. Only 10 digits, or 11 with a leading
 * 1, become a link: anything else (short code, extension, international) has
 * no call button rather than a link that dials the wrong thing.
 */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1)
    : digits.length === 10 ? digits : null;
  return ten ? `tel:+1${ten}` : null;
}

/**
 * Why a lead is worth a call, as at most two 1-3 word labels, strongest
 * first. Mirrors the biggest movers of the live score (0020): reply recency,
 * urgency, quote size, proximity, freshness.
 */
export function hotReasons(l: Lead, signal: LeadSignal | undefined, now: Date): string[] {
  const out: string[] = [];
  const reply = ms(signal?.last_lead_reply_at);
  if (reply != null && now.getTime() - reply <= 3 * DAY_MS) {
    const a = ago(signal!.last_lead_reply_at!, now);
    out.push(a === 'now' ? 'Replied just now' : `Replied ${a} ago`);
  }
  if (signal?.timeframe && urgencyFor(signal.timeframe) >= 0.85) out.push('Wants it soon');
  if (l.quote_cents != null && l.quote_cents >= BIG_QUOTE_CENTS) out.push(`${moneyShort(l.quote_cents)} job`);
  if (signal?.tier === '1') out.push('Close by');
  const created = ms(l.created_at);
  if (created != null && now.getTime() - created <= 2 * DAY_MS) out.push('New lead');
  return out.slice(0, 2);
}

/**
 * Who to call: the top 5 by live score, the same ranking as the dashboard's
 * Hot Leads card (scoreStats), minus leads already marked won or lost. A sold
 * job is not a sales call, and a lost one asked to be left alone.
 */
export function callList(leads: Lead[], optedOutPhones?: ReadonlySet<string>): Lead[] {
  const contactable = optedOutPhones ? filterOptedOutLeads(leads, optedOutPhones) : leads;
  return scoreStats(contactable.filter(l => l.job_outcome == null)).hot;
}

export type WaitKind = 'handed' | 'replied' | 'new';
export type WaitItem = { lead: Lead; kind: WaitKind; at: string };

const WAIT_ORDER: Record<WaitKind, number> = { handed: 0, replied: 1, new: 2 };

/**
 * What is waiting on the owner. Each open lead lands in at most one bucket,
 * first match wins:
 *
 *   handed   A person has the conversation (handler = 'human') and either the
 *            lead's last text has no answer after it, or the handoff happened
 *            in the last HANDOFF_FRESH_HOURS. Once someone answers and the
 *            handoff is old, it drops off: the ball is in the lead's court.
 *   replied  The agent has the conversation and the lead texted back in the
 *            last REPLY_WINDOW_HOURS. The agent answers on its own; this is a
 *            heads-up that a lead is live, not a chore.
 *   new      Arrived in the last NEW_WINDOW_HOURS.
 *
 * Closed leads (serviced, won, lost) never wait. `lastOutbound` is the newest
 * outbound message per lead (agent or person). When it is unknown (the read
 * failed, `null`), every human-handled reply counts as unanswered: showing one
 * too many beats hiding a customer who is waiting.
 *
 * Sorted handed, then replied, then new; newest first inside each.
 */
export function waitingOnMe(
  leads: Lead[],
  signals: Map<string, LeadSignal>,
  lastOutbound: Map<string, string> | null,
  now: Date,
): { items: WaitItem[]; counts: Record<WaitKind, number> } {
  const t = now.getTime();
  const items: WaitItem[] = [];
  for (const l of leads) {
    if (isClosed(l)) continue;
    const replyAt = signals.get(l.id)?.last_lead_reply_at ?? null;
    const reply = ms(replyAt);
    if (l.handler === 'human') {
      const out = lastOutbound ? ms(lastOutbound.get(l.id)) : null;
      const unanswered = reply != null && (out == null || reply > out);
      if (unanswered) { items.push({ lead: l, kind: 'handed', at: replyAt! }); continue; }
      const handedAt = ms(l.handler_changed_at);
      if (handedAt != null && t - handedAt <= HANDOFF_FRESH_HOURS * HOUR_MS) {
        items.push({ lead: l, kind: 'handed', at: l.handler_changed_at! });
        continue;
      }
    } else if (reply != null && t - reply <= REPLY_WINDOW_HOURS * HOUR_MS) {
      items.push({ lead: l, kind: 'replied', at: replyAt! });
      continue;
    }
    const created = ms(l.created_at);
    if (created != null && t - created <= NEW_WINDOW_HOURS * HOUR_MS) {
      items.push({ lead: l, kind: 'new', at: l.created_at });
    }
  }
  items.sort((a, b) => WAIT_ORDER[a.kind] - WAIT_ORDER[b.kind] || (ms(b.at)! - ms(a.at)!));
  const counts: Record<WaitKind, number> = { handed: 0, replied: 0, new: 0 };
  for (const i of items) counts[i.kind]++;
  return { items, counts };
}

export type StuckItem =
  | { lead: Lead; kind: 'owed'; owedCents: number }
  | { lead: Lead; kind: 'quote_stale'; days: number };

/** What won jobs still owe: each job's own balance, floored at 0, summed. */
export function owedTotal(stuck: StuckItem[]): number {
  return stuck.reduce((t, s) => t + (s.kind === 'owed' ? s.owedCents : 0), 0);
}

/**
 * Which open leads need their newest outbound message, and from when: open,
 * human-handled leads the lead has texted. `since` is the earliest of those
 * texts, so fetchLastOutbound only reads messages that could answer one.
 * null `since` means nothing to read.
 */
export function outboundCandidates(
  open: Lead[], signals: Map<string, LeadSignal>,
): { ids: string[]; since: string | null } {
  const ids: string[] = [];
  let since: string | null = null;
  let sinceMs = Infinity;
  for (const l of open) {
    if (isClosed(l) || l.handler !== 'human') continue;
    const at = signals.get(l.id)?.last_lead_reply_at ?? null;
    const t = ms(at);
    if (t == null) continue;
    ids.push(l.id);
    if (t < sinceMs) { sinceMs = t; since = at; }
  }
  return { ids, since };
}

/**
 * What is stuck:
 *
 *   owed         Marked won with a job value, and the payments recorded add up
 *                to less than it. Serviced or not: a finished, unpaid job is
 *                the most stuck thing there is. Skipped entirely when
 *                `paidByLead` is null (the payments read failed), so a read
 *                error never shows paid customers as owing.
 *   quote_stale  Quoted, no won/lost yet, and the quote has sat for
 *                QUOTE_STALE_DAYS or more (status stamp, else arrival).
 *
 * Money owed first (biggest first), then the oldest quotes.
 */
export function stuckList(leads: Lead[], paidByLead: Map<string, number> | null, now: Date): StuckItem[] {
  const owed: StuckItem[] = [];
  const stale: StuckItem[] = [];
  const seen = new Set<string>();
  for (const l of leads) {
    // Callers merge several queries (won leads, stale quotes); a lead counts once.
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    if (paidByLead && l.job_outcome === 'won' && (l.job_value_cents ?? 0) > 0) {
      const due = l.job_value_cents! - (paidByLead.get(l.id) ?? 0);
      if (due > 0) owed.push({ lead: l, kind: 'owed', owedCents: due });
      continue;
    }
    if (l.status === 'quoted' && l.job_outcome == null) {
      const since = ms(l.status_updated_at ?? l.created_at);
      if (since == null) continue;
      const days = Math.floor((now.getTime() - since) / DAY_MS);
      if (days >= QUOTE_STALE_DAYS) stale.push({ lead: l, kind: 'quote_stale', days });
    }
  }
  owed.sort((a, b) => (b as { owedCents: number }).owedCents - (a as { owedCents: number }).owedCents);
  stale.sort((a, b) => (b as { days: number }).days - (a as { days: number }).days);
  return [...owed, ...stale];
}

export type BookSource = { source: string; leads: number; won: number; collectedCents: number };

export type Books = {
  won: number;
  soldCents: number;
  collectedCents: number;
  /** Sum of each won job's own positive balance. null when the won-lead or
   *  payment reads were not complete: unknown, never a guess. */
  owedCents: number | null;
  hasOutcomes: boolean;
  /** Sources with at least one lead, most cash collected first. */
  sources: BookSource[];
  /** Cash back per $1 of Meta spend, last 30 days. null without spend. */
  metaReturn: number | null;
};

/**
 * The "on the books" numbers. Won, sold and collected come from the
 * whole-book revenue view (0021, summed in SQL; the same numbers as the
 * Return by Source card). "To collect" is passed in: the sum of every won
 * job's own balance, each floored at 0 (owedTotal), so a job paid over its
 * value never hides money owed on another and the tile equals the Stuck
 * "Owes" rows. The partner share in `summary.partner` is dropped on purpose.
 */
export function booksSummary(summary: ReturnSummary, owedCents: number | null): Books {
  return {
    won: summary.totals.won,
    soldCents: summary.totals.jobValueCents,
    collectedCents: summary.totals.collectedCents,
    owedCents,
    hasOutcomes: summary.hasOutcomes,
    sources: summary.rows
      .filter(r => r.leads > 0)
      .map(r => ({ source: r.source, leads: r.leads, won: r.won, collectedCents: r.collected_cents })),
    metaReturn: summary.meta.returnPerDollar,
  };
}

// ---------------------------------------------------------------------------
// View model: everything the screen shows, as display-ready rows. The page
// builds this on the server; CommandCenter.tsx only lays it out.
// ---------------------------------------------------------------------------

/** Rows shown per list before the "+N" link to the pipeline. */
export const WAIT_ROWS = 6;
export const STUCK_ROWS = 5;

type RowBase = { id: string; name: string; tel: string | null; href: string };
export type CallRow = RowBase & { score: number; reasons: string[]; detail: string };
export type WaitRow = RowBase & { kind: WaitKind; when: string };
export type StuckRow = RowBase & { kind: StuckItem['kind']; label: string };

export type CommandModel = {
  call: CallRow[];
  /** False when no lead has a score at all (scoring not running). */
  scored: boolean;
  waiting: { rows: WaitRow[]; counts: Record<WaitKind, number>; more: number };
  stuck: { rows: StuckRow[]; more: number };
  /** null when the revenue view is not readable (0021 not applied, or a read error). */
  books: Books | null;
  /** A card whose source scan hit its page ceiling shows "More not shown". */
  incomplete: { call: boolean; waiting: boolean; stuck: boolean; books: boolean };
  /** True when the live opt-out read failed; contact-prompting lists are hidden. */
  optOutUnavailable: boolean;
  pipelineHref: string;
};

export function buildCommandModel(input: {
  sessionId: string;
  /** Every open lead, live score merged (fetchOpenBook). Call now, Waiting
   *  and stale quotes all come from this one complete set. */
  openLeads: Lead[];
  /** Every lead marked won (fetchWonLeads), for the money-owed rows. */
  wonLeads: Lead[];
  /** Score-view rows for the open leads. */
  signals: Map<string, LeadSignal>;
  /** False when a read failed or stopped at its page ceiling. `won` covers
   *  the won-lead scan, `paid` the payment reads for those leads. */
  complete: { open: boolean; won: boolean; paid: boolean };
  lastOutbound: Map<string, string> | null;
  paidByLead: Map<string, number> | null;
  summary: ReturnSummary | null;
  now: Date;
  /** Turns a lead into its display name (leadLabel on the page). */
  label: (l: Lead) => string;
  /** Live J&C latch; a failed read fails closed for contact prompts. */
  optedOutPhones?: ReadonlySet<string>;
  optedOutReadAvailable?: boolean;
}): CommandModel {
  const { sessionId, signals, now, label } = input;
  const pipelineHref = `/dash/${sessionId}/pipeline`;
  const base = (l: Lead): RowBase => ({
    id: l.id, name: label(l), tel: telHref(l.phone), href: `${pipelineHref}?spotlight=${l.id}`,
  });

  const optOutUnavailable = input.optedOutReadAvailable === false;
  const contactableOpenLeads = optOutUnavailable
    ? []
    : filterOptedOutLeads(input.openLeads, input.optedOutPhones ?? new Set());
  // Pass the latch set at the boundary where Call now is built. This keeps
  // the real wiring covered even if the upstream contactable slice changes.
  const call = callList(input.openLeads, input.optedOutPhones ?? new Set()).map(l => ({
    ...base(l),
    score: l.score!,
    reasons: hotReasons(l, signals.get(l.id), now),
    detail: [l.service, l.city].filter(Boolean).join(' · '),
  }));

  const waiting = waitingOnMe(contactableOpenLeads, signals, input.lastOutbound, now);
  // Money owed is only known when every won lead AND all their payments
  // were read; anything less leaves both the tile and the rows unknown.
  const owedKnown = input.complete.won && input.complete.paid && input.paidByLead != null;
  const stuck = stuckList([...input.wonLeads, ...contactableOpenLeads], owedKnown ? input.paidByLead : null, now);

  return {
    call: optOutUnavailable ? [] : call,
    // No open leads is "nobody to call", not "scoring is off".
    scored: contactableOpenLeads.length === 0 || contactableOpenLeads.some(l => l.score != null),
    waiting: {
      rows: waiting.items.slice(0, WAIT_ROWS).map(i => ({ ...base(i.lead), kind: i.kind, when: ago(i.at, now) })),
      counts: waiting.counts,
      more: Math.max(0, waiting.items.length - WAIT_ROWS),
    },
    stuck: {
      rows: stuck.slice(0, STUCK_ROWS).map(s => ({
        ...base(s.lead),
        kind: s.kind,
        label: s.kind === 'owed' ? `Owes ${moneyShort(s.owedCents)}` : `Quote ${s.days}d`,
      })),
      more: Math.max(0, stuck.length - STUCK_ROWS),
    },
    books: input.summary ? booksSummary(input.summary, owedKnown ? owedTotal(stuck) : null) : null,
    incomplete: {
      call: !input.complete.open,
      waiting: !input.complete.open,
      stuck: !input.complete.open || !owedKnown,
      books: input.summary != null && !owedKnown,
    },
    optOutUnavailable,
    pipelineHref,
  };
}
