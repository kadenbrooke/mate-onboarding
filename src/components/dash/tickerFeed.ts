import type { ClientEvent } from '@/lib/metrics/events';
import { leadKeyFromPhone } from '@/lib/metrics/eventSources';

// The Ticker is a shift register ROLLED UP BY LEAD: one chip per lead, newest
// activity at the LEFT, older leads trailing off to the right. A lead who is
// already on the strip and gets texted again does not gain a second chip -- the
// existing one moves to the front and its count goes up. Whatever falls past
// MAX_HELD is gone.
//
// Split out of the component so ordering, grouping and dedupe are testable
// without a DOM, a timer, or a fetch.

/** How many chips the strip keeps. Comfortably more than fit on a wide screen,
 *  so the right-hand overflow always has something to clip. */
export const MAX_HELD = 24;

const ms = (e: ClientEvent) => new Date(e.created_at).getTime();

/**
 * The lead a row belongs to, for rollup purposes.
 *
 * `lead_key` (migration 0015, normalised phone) is the real answer and covers
 * SMS and call/quote rows alike, so a lead who both called and texted owns one
 * chip.
 *
 * The source_key fallback below stays for rows written before 0015 by a path
 * that has not been redeployed -- it only ever handled the SMS shape. Rows with
 * neither group with nothing but themselves, which is the honest outcome for a
 * handoff signal (not about a nameable lead) or an event whose number was never
 * recorded.
 */
export function rollupKey(e: ClientEvent): string {
  if (e.lead_key) return `phone:${e.lead_key}`;
  const parts = (e.source_key ?? '').split(':');
  const legacy = parts[0] === 'jcsms' ? leadKeyFromPhone(parts[1]) : null;
  if (legacy) return `phone:${legacy}`;
  return `id:${e.id}`;
}

/** One lead's slot on the strip. */
export type TickerGroup = {
  /** rollupKey — stable across re-texts, which is what lets a chip MOVE
   *  rather than duplicate. Also the React key. */
  key: string;
  /** The newest event for this lead; its message is what the chip shows. */
  latest: ClientEvent;
  /** How many events rolled into this chip. 1 means no rollup happened. */
  count: number;
};

/** Newest first, with a stable key tiebreak so groups sharing a created_at
 *  (the poller batch-writes several rows on one timestamp) do not reshuffle
 *  between renders and visibly jitter the strip. */
function byNewest(a: TickerGroup, b: TickerGroup): number {
  const diff = ms(b.latest) - ms(a.latest);
  return diff !== 0 ? diff : a.key.localeCompare(b.key);
}

/**
 * Collapse a flat event list into one chip per lead, newest lead first.
 *
 * Position is decided by the lead's NEWEST event, which is what makes the
 * founder's rule fall out: a lead sitting fifth who gets texted again has a
 * newer `latest`, so they sort to the front and vacate the fifth slot in the
 * same pass. No move bookkeeping, no chance of appearing twice.
 */
export function rollupEvents(events: ClientEvent[]): TickerGroup[] {
  const groups = new Map<string, TickerGroup>();
  for (const e of events) {
    const key = rollupKey(e);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, latest: e, count: 1 });
      continue;
    }
    existing.count += 1;
    if (ms(e) > ms(existing.latest)) existing.latest = e;
  }
  return [...groups.values()].sort(byNewest).slice(0, MAX_HELD);
}

/**
 * Fold a freshly polled batch into the held event list.
 *
 * Dedupes on id: `since` is inclusive-adjacent in practice, so two events on
 * the same millisecond mean a poll can hand back a row already on screen.
 *
 * Returns the SAME array reference when nothing is new, so the component can
 * skip a re-render and, more importantly, skip re-running the entry animation
 * on chips that did not change.
 */
export function mergeEvents(current: ClientEvent[], incoming: ClientEvent[]): ClientEvent[] {
  if (incoming.length === 0) return current;
  const held = new Set(current.map(e => e.id));
  const fresh = incoming.filter(e => !held.has(e.id));
  if (fresh.length === 0) return current;
  // Keep more raw events than chips: MAX_HELD leads can be backed by many more
  // rows once rollup collapses them, and throwing rows away early would make
  // the counts lie.
  return [...fresh, ...current]
    .sort((a, b) => ms(b) - ms(a) || a.id.localeCompare(b.id))
    .slice(0, MAX_HELD * 8);
}

/** The watermark the next poll asks from: the newest created_at held. Null when
 *  empty, the one case where there is nothing sensible to ask for. */
export function newestTimestamp(events: ClientEvent[]): string | null {
  if (events.length === 0) return null;
  return events.reduce(
    (max, e) => (ms(e) > new Date(max).getTime() ? e.created_at : max),
    events[0].created_at,
  );
}

/** Group keys that were not on the strip before: these get the push-in
 *  animation. A chip that merely MOVED (re-texted lead) is deliberately not in
 *  here -- it slides to its new slot with the rest, it does not re-enter. */
export function enteringKeys(prev: TickerGroup[], next: TickerGroup[]): Set<string> {
  const before = new Set(prev.map(g => g.key));
  return new Set(next.filter(g => !before.has(g.key)).map(g => g.key));
}

// --- Chip -> lead deep link ------------------------------------------------
// Clicking a chip opens that lead's conversation on the pipeline sheet. The
// event row has no lead id, so the phone inside its rollup key is matched
// against the leads the dash already loaded -- no extra query, and the map is
// built from the same 500-row fetch the table uses.

/** Digits only, last 10, so +18015551234 / 8015551234 / (801) 555-1234 all
 *  agree. Re-exported from eventSources so the write path (lead_key), the SQL
 *  normaliser, and this lookup cannot drift apart. */
export const phoneDigits = leadKeyFromPhone;

export type LeadRef = { id: string; phone?: string | null };

/** phone -> lead id. First lead wins on a duplicate number: the dash fetch is
 *  ordered newest first, so that is the most recent row for that caller. */
export function leadPhoneIndex(leads: LeadRef[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const l of leads) {
    const key = phoneDigits(l.phone);
    if (key && !index.has(key)) index.set(key, l.id);
  }
  return index;
}

/**
 * Where a chip navigates, or null when it should stay inert.
 *
 * Null happens two ways, both honest: the chip is a postcall/signal row with
 * no lead reference to resolve, or its phone matches no lead the client has
 * (an event whose lead was deleted). A dead link that lands on an empty
 * pipeline is worse than a chip that simply is not a link.
 */
export function chipHref(
  group: TickerGroup,
  sessionId: string,
  index: Map<string, string>,
): string | null {
  if (!group.key.startsWith('phone:')) return null;
  const key = phoneDigits(group.key.slice('phone:'.length));
  const leadId = key ? index.get(key) : undefined;
  if (!leadId) return null;
  // Same ordering the NEW LEADS tile lands on, with the lead's thread open.
  return `/dash/${sessionId}/pipeline?sort=captured&spotlight=${leadId}`;
}
