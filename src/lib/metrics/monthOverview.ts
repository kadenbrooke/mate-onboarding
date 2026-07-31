import type { Lead } from './leads';
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
  revenueWon: MonthStat;
  quotedThisMonthCents: number;
  winRatePct: number;
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

  const wonThisMonth = thisMonth.filter(l => l.status === 'won');
  const wonPrevMonth = prevMonth.filter(l => l.status === 'won');
  const revenueWonCents = wonThisMonth.reduce((a, l) => a + (l.quote_cents ?? 0), 0);
  const revenueWonPrevCents = wonPrevMonth.reduce((a, l) => a + (l.quote_cents ?? 0), 0);

  const quotedThisMonthCents = thisMonth.reduce((a, l) => a + (l.quote_cents ?? 0), 0);

  const settledThisMonth = thisMonth.filter(l => l.status === 'won' || l.status === 'lost');
  const winRatePct = settledThisMonth.length
    ? Math.round((wonThisMonth.length / settledThisMonth.length) * 100)
    : 0;

  const callsThisMonth = events.filter(e => inRange(e.created_at, start, now)).length;
  const callsPrevMonth = events.filter(e => inRange(e.created_at, prevStart, start)).length;

  const respThisMonth = avgReplySeconds(thisMonth);
  const respPrevMonth = avgReplySeconds(prevMonth);

  return {
    monthLabel: now.toLocaleDateString('en-US', { month: 'long' }),
    revenueWon: { value: revenueWonCents, pct: pctChange(revenueWonCents, revenueWonPrevCents) },
    quotedThisMonthCents,
    winRatePct,
    jobsCompleted: { value: wonThisMonth.length, pct: pctChange(wonThisMonth.length, wonPrevMonth.length) },
    leadsAcquired: { value: thisMonth.length, pct: pctChange(thisMonth.length, prevMonth.length) },
    callsHandled: { value: callsThisMonth, pct: pctChange(callsThisMonth, callsPrevMonth) },
    avgResponseSeconds: { value: respThisMonth, pct: pctChange(respThisMonth, respPrevMonth) },
  };
}
