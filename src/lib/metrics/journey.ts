// src/lib/metrics/journey.ts
import { isServiced, type Lead } from './leads';

export function journeyRiver(leads: Lead[]) {
  const bySource = new Map<string, number>();
  for (const l of leads) bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
  const sources = [...bySource.entries()]
    .map(([source, count]) => ({ source, count, free: source === 'referral' || source === 'revived' }))
    .sort((a, b) => b.count - a.count);
  const priced = leads.filter(l => l.quote_cents != null).length;
  const open = leads.filter(l => l.status === 'open').length;
  const booked = leads.filter(l => l.status === 'booked').length;
  const quoted = leads.filter(l => l.status === 'quoted').length;
  const serviced = leads.filter(l => l.status === 'serviced').length;
  const servicedCents = leads.filter(isServiced).reduce((a, l) => a + (l.quote_cents ?? 0), 0);
  return { sources, priced, open, booked, quoted, serviced, servicedCents, total: leads.length };
}
