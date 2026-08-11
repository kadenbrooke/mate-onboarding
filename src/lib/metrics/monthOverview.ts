import { isServiced, type Lead } from './leads';
import type { ClientEvent } from './events';

// ---------------------------------------------------------------------------
// Month Overview banner -- pure math layer. Calendar-month-to-date vs the
// same span of the prior calendar month (not a trailing 30-day window), so
// "this month" reads the way a business owner expects it to.
//
// This is the "CEO glance" zone: the handful of numbers that answer, in the
// time it takes to unlock a phone, "is this thing making me money and
// keeping customers happy." Money in, activity, speed, conversion.
// ---------------------------------------------------------------------------

export type MonthStat = { value: number; pct: number };

export type MonthOverview = {
  monthLabel: string;
  revenueEarned: MonthStat;
  quotedThisMonthCents: number;
  /** Share of engaged leads (booked/quoted/serviced) that reached serviced. */
  serviceRatePct: number;
  jobsCompleted: MonthStat;
  leadsAcquired: MonthStat;
  callsHandled: MonthStat;
  avgResponseSeconds: MonthStat;
};

function monthBounds(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { start, prevStart };
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
}

/** Month-over-month % change. No activity either month reads 0, not NaN. */
function pctChange(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

function avgReplySeconds(leads: Lead[]): number {
  const replied = leads.filter(l => l.first_reply_seconds != null);
  return replied.length
    ? Math.round(replied.reduce((a, l) => a + l.first_reply_seconds!, 0) / replied.length)
    : 0;
}

export function monthOverview(leads: Lead[], events: ClientEvent[], now = new Date()): MonthOverview {
  const { start, prevStart } = monthBounds(now);
  const thisMonth = leads.filter(l => inRange(l.created_at, start, now));
  const prevMonth = leads.filter(l => inRange(l.created_at, prevStart, start));

  const servicedThisMonth = thisMonth.filter(isServiced);
  const servicedPrevMonth = prevMonth.filter(isServiced);
  const revenueEarnedCents = servicedThisMonth.reduce((a, l) => a + (l.quote_cents ?? 0), 0);
  const revenueEarnedPrevCents = servicedPrevMonth.reduce((a, l) => a + (l.quote_cents ?? 0), 0);

  const quotedThisMonthCents = thisMonth.reduce((a, l) => a + (l.quote_cents ?? 0), 0);

  // Denominator is every lead that got somewhere (booked/quoted/serviced), not
  // won+lost: 'open' leads have not had their shot yet, so counting them would
  // punish a healthy month with lots of fresh leads.
  const engagedThisMonth = thisMonth.filter(l => l.status !== 'open');
  const serviceRatePct = engagedThisMonth.length
    ? Math.round((servicedThisMonth.length / engagedThisMonth.length) * 100)
    : 0;

  const callsThisMonth = events.filter(e => inRange(e.created_at, start, now)).length;
  const callsPrevMonth = events.filter(e => inRange(e.created_at, prevStart, start)).length;

  const respThisMonth = avgReplySeconds(thisMonth);
  const respPrevMonth = avgReplySeconds(prevMonth);

  return {
    monthLabel: now.toLocaleDateString('en-US', { month: 'long' }),
    revenueEarned: { value: revenueEarnedCents, pct: pctChange(revenueEarnedCents, revenueEarnedPrevCents) },
    quotedThisMonthCents,
    serviceRatePct,
    jobsCompleted: { value: servicedThisMonth.length, pct: pctChange(servicedThisMonth.length, servicedPrevMonth.length) },
    leadsAcquired: { value: thisMonth.length, pct: pctChange(thisMonth.length, prevMonth.length) },
    callsHandled: { value: callsThisMonth, pct: pctChange(callsThisMonth, callsPrevMonth) },
    avgResponseSeconds: { value: respThisMonth, pct: pctChange(respThisMonth, respPrevMonth) },
  };
}
