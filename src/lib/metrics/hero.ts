import { isServiced, revenueAt, type Lead } from './leads';
import type { ClientEvent } from './events';

/**
 * Hero stats. `recoveredCents` is AGENT-ATTRIBUTED revenue (serviced leads the
 * agent worked), deliberately NOT total business revenue: `roiMultiple` divides
 * it by what the client pays us, so feeding it QuickBooks' whole-business
 * revenue would produce a meaningless ROI. The QBO number is a separate stat
 * with its own tile (see monthRevenue in monthOverview.ts).
 *
 * `monthlyRetainerCents` is null when the retainer is unknown (no linked
 * contact, or no amount on it). roiMultiple is then null too, because "0x what
 * you pay" is a claim we cannot make without knowing what they pay.
 */
export function heroStats(leads: Lead[], opts: {
  monthlyRetainerCents: number | null; actionsThisWeek: number; minutesPerAction: number;
}) {
  const recoveredCents = leads.filter(isServiced)
    .reduce((a, l) => a + (l.quote_cents ?? 0), 0);
  const retainer = opts.monthlyRetainerCents;
  return {
    recoveredCents,
    roiMultiple: retainer != null && retainer > 0 ? recoveredCents / retainer : null,
    actions: opts.actionsThisWeek,
    hoursSaved: Math.round((opts.actionsThisWeek * opts.minutesPerAction) / 60),
  };
}

// ---------------------------------------------------------------------------
// Weekly series for the hero stat cards: area sparkline buckets + week-over-
// week trend badge. Buckets are trailing 7-day windows (oldest first, current
// week last) so "this week vs last week" is buckets[n-1] vs buckets[n-2].
// ---------------------------------------------------------------------------

export type HeroSeries = { buckets: number[]; trendPct: number };

const WEEK_MS = 7 * 86400_000;

export function weeklyBuckets(
  items: { at: string; value: number }[],
  weeks = 8,
  now = new Date(),
): number[] {
  const buckets = Array<number>(weeks).fill(0);
  for (const item of items) {
    const diffMs = now.getTime() - new Date(item.at).getTime();
    if (diffMs < 0) continue;
    const weeksAgo = Math.floor(diffMs / WEEK_MS);
    if (weeksAgo < weeks) buckets[weeks - 1 - weeksAgo] += item.value;
  }
  return buckets;
}

/** WoW change of the last bucket vs the one before. Empty prior week with
 *  activity now reads +100; no activity either week reads 0. */
export function trendPct(buckets: number[]): number {
  if (buckets.length < 2) return 0;
  const cur = buckets[buckets.length - 1];
  const prev = buckets[buckets.length - 2];
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

export function heroSeries(
  leads: Lead[],
  events: ClientEvent[],
  opts: { minutesPerAction: number },
  now = new Date(),
): { recovered: HeroSeries; hours: HeroSeries; actions: HeroSeries } {
  // Dated by when the job was serviced (revenueAt), not when the lead arrived:
  // a June lead serviced last week belongs in last week's bucket.
  const servicedItems = leads
    .filter(isServiced)
    .map(l => ({ at: revenueAt(l), value: l.quote_cents ?? 0 }));
  const actionItems = events.map(e => ({ at: e.created_at, value: 1 }));

  const recoveredBuckets = weeklyBuckets(servicedItems, 8, now);
  const actionBuckets = weeklyBuckets(actionItems, 8, now);
  const hourBuckets = actionBuckets.map(c => (c * opts.minutesPerAction) / 60);

  return {
    recovered: { buckets: recoveredBuckets, trendPct: trendPct(recoveredBuckets) },
    hours: { buckets: hourBuckets, trendPct: trendPct(hourBuckets) },
    actions: { buckets: actionBuckets, trendPct: trendPct(actionBuckets) },
  };
}
