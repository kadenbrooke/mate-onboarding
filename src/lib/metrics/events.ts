// src/lib/metrics/events.ts
export type ClientEvent = {
  id: string;
  agent: 'first_responder' | 'reactivator' | 'cultivator' | 'reputation';
  kind: string;
  message: string;
  created_at: string;
};

export function actionsThisWeek(events: ClientEvent[]): number {
  const cutoff = Date.now() - 7 * 86400_000;
  return events.filter(e => new Date(e.created_at).getTime() >= cutoff).length;
}
