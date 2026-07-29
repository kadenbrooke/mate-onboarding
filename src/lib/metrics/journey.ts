// src/lib/metrics/journey.ts
import type { Lead } from './leads';

export function journeyRiver(leads: Lead[]) {
  const bySource = new Map<string, number>();
  for (const l of leads) bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
  const sources = [...bySource.entries()]
    .map(([source, count]) => ({ source, count, free: source === 'referral' || source === 'revived' }))
    .sort((a, b) => b.count - a.count);
  const quoted = leads.filter(l => l.quote_cents != null).length;
  const won = leads.filter(l => l.status === 'won').length;
  const open = leads.filter(l => l.status === 'open').length;
  const lost = leads.filter(l => l.status === 'lost').length;
  const wonCents = leads.filter(l => l.status === 'won').reduce((a, l) => a + (l.quote_cents ?? 0), 0);
  return { sources, quoted, won, open, lost, wonCents, total: leads.length };
}
