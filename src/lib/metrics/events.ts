// src/lib/metrics/events.ts
export type ClientEvent = {
  id: string;
  agent: 'first_responder' | 'reactivator' | 'cultivator' | 'reputation';
  kind: string;
  message: string;
  created_at: string;
  /** Deterministic dedupe key from eventSources.ts, e.g.
   *  `jcsms:+18015551234:out:<iso>`. The Ticker reads the lead identity back
   *  out of it to roll repeat activity into one chip (see tickerFeed.ts).
   *  Optional: the seeded demo rows and older fixtures predate it. */
  source_key?: string | null;
};

export function actionsThisWeek(events: ClientEvent[]): number {
  const cutoff = Date.now() - 7 * 86400_000;
  return events.filter(e => new Date(e.created_at).getTime() >= cutoff).length;
}
