import type { Lead } from './leads';

export function heroStats(leads: Lead[], opts: {
  monthlyRetainerCents: number; actionsThisWeek: number; minutesPerAction: number;
}) {
  const recoveredCents = leads.filter(l => l.status === 'won')
    .reduce((a, l) => a + (l.quote_cents ?? 0), 0);
  return {
    recoveredCents,
    roiMultiple: opts.monthlyRetainerCents ? recoveredCents / opts.monthlyRetainerCents : 0,
    actions: opts.actionsThisWeek,
    hoursSaved: Math.round((opts.actionsThisWeek * opts.minutesPerAction) / 60),
  };
}
