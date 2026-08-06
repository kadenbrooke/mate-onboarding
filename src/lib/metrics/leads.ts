export type Lead = {
  id: string; name: string | null; city: string | null; service: string | null;
  phone: string | null;
  // Closed taxonomy going forward: meta | call | text | referral | google (2026-08-05).
  // Legacy values (missed_call, meta_ads, unknown) were renamed/removed table-wide;
  // texted_in/web_form/revived are kept only because live demo-session rows still use
  // them (out of scope to migrate -- see reference_mate_jc_data_exposure_incident).
  source: 'meta' | 'call' | 'text' | 'referral' | 'google' | 'missed_call' | 'texted_in' | 'web_form' | 'revived' | 'unknown';
  referrer_name: string | null; score: number | null;
  status: 'open' | 'won' | 'lost'; quote_cents: number | null;
  // Who is driving the conversation: Mate's agent ('agent') or the client ('human').
  // Optional + nullable because legacy/demo rows may predate the column or omit it;
  // the UI treats null/absent as 'agent' (see normalizeHandler).
  handler?: 'agent' | 'human' | null;
  contacted: boolean; after_hours: boolean; first_reply_seconds: number | null;
  created_at: string;
};

const FREE_SOURCES = new Set(['referral', 'revived']);

/** The visible period tabs on the Leads card. Calendar-to-date, not trailing. */
export type Range = 'WEEK' | 'MONTH' | 'YEAR';

function startOfWeek(now = new Date()): Date {
  // Sunday start: getDay() returns 0 for Sunday, so subtracting it lands on
  // this week's Sunday.
  const sunday = new Date(now); sunday.setHours(0, 0, 0, 0);
  sunday.setDate(now.getDate() - now.getDay());
  return sunday;
}

function localDayKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function weekBars(leads: Lead[], now = new Date()) {
  // Static calendar week, Sunday -> Saturday. NOT a trailing window: the bars
  // always span this week's Sunday through Saturday regardless of the weekday.
  // Runs in the browser so "week" means the client's local week; server
  // prerender may briefly show UTC buckets (charts mount-gate to avoid a
  // hydration mismatch).
  const sunday = startOfWeek(now);
  const dayKeys: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday); d.setDate(sunday.getDate() + i);
    dayKeys.push(localDayKey(d));
  }
  const bars = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => ({ day, count: 0 }));
  for (const l of leads) {
    const idx = dayKeys.indexOf(localDayKey(new Date(l.created_at)));
    if (idx !== -1) bars[idx].count++;
  }
  return bars;
}

export function sourceBreakdown(leads: Lead[]) {
  const bySource = new Map<string, number>();
  for (const l of leads) bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
  const segments = [...bySource.entries()].map(([source, count]) => ({
    source, count, free: FREE_SOURCES.has(source),
  })).sort((a, b) => b.count - a.count);
  return { segments, freeCount: leads.filter(l => FREE_SOURCES.has(l.source)).length, total: leads.length };
}

export function pipelineTotals(leads: Lead[]) {
  const acc = { won: { cents: 0, count: 0 }, lost: { cents: 0, count: 0 }, open: { cents: 0, count: 0 } };
  for (const l of leads) {
    acc[l.status].count++;
    acc[l.status].cents += l.quote_cents ?? 0;
  }
  const settled = acc.won.count + acc.lost.count;
  return {
    wonCents: acc.won.cents, lostCents: acc.lost.cents, openCents: acc.open.cents,
    counts: { won: acc.won.count, lost: acc.lost.count, open: acc.open.count },
    winRate: settled === 0 ? 0 : Math.round((acc.won.count / settled) * 100),
  };
}

export function valueWheel(leads: Lead[]) {
  const byService = new Map<string, Lead[]>();
  for (const l of leads) {
    const key = l.service ?? 'Other';
    const existing = byService.get(key);
    if (existing) existing.push(l); else byService.set(key, [l]);
  }
  const total = leads.length || 1;
  return [...byService.entries()].map(([service, group]) => {
    const quoted = group.filter(g => g.quote_cents != null);
    return {
      service, count: group.length, share: group.length / total,
      avgCents: quoted.length ? Math.round(quoted.reduce((a, g) => a + g.quote_cents!, 0) / quoted.length) : 0,
    };
  }).sort((a, b) => b.count - a.count);
}

export function areaRanking(leads: Lead[]) {
  const byCity = new Map<string, number>();
  for (const l of leads) if (l.city) byCity.set(l.city, (byCity.get(l.city) ?? 0) + 1);
  return [...byCity.entries()].map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);
}

export function monthBuckets(leads: Lead[], now = new Date()): number[] {
  // Calendar month to date: one bucket per day from the 1st of this month
  // through today (index 0 = the 1st, last index = today). NOT a trailing 30.
  const y = now.getFullYear();
  const m = now.getMonth();
  const days = now.getDate();
  const buckets = Array(days).fill(0);
  for (const l of leads) {
    const d = new Date(l.created_at);
    if (d.getFullYear() === y && d.getMonth() === m) {
      const day = d.getDate();
      if (day >= 1 && day <= days) buckets[day - 1]++;
    }
  }
  return buckets;
}

export function yearBuckets(leads: Lead[], now = new Date()): number[] {
  // Calendar year to date: one bucket per month from January through the
  // current month (index 0 = January, last index = this month). NOT a
  // trailing 52 weeks.
  const y = now.getFullYear();
  const months = now.getMonth() + 1;
  const buckets = Array(months).fill(0);
  for (const l of leads) {
    const d = new Date(l.created_at);
    if (d.getFullYear() === y) {
      const mo = d.getMonth();
      if (mo >= 0 && mo < months) buckets[mo]++;
    }
  }
  return buckets;
}

/** Start of the calendar period a range tab represents. */
export function periodStart(range: Range, now = new Date()): Date {
  if (range === 'WEEK') return startOfWeek(now);
  if (range === 'MONTH') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1);
}

/** Leads created within the current calendar period (inclusive of both ends).
 *  WEEK = this Sun..Sat week, MONTH = this calendar month, YEAR = this
 *  calendar year. Used by the headline count and the outcome strip so both
 *  match the chart. */
export function leadsInPeriod(leads: Lead[], range: Range, now = new Date()): Lead[] {
  const start = periodStart(range, now).getTime();
  const end = now.getTime();
  return leads.filter(l => {
    const t = new Date(l.created_at).getTime();
    return t >= start && t <= end;
  });
}

/** Leads created within an explicit [start, end] range, inclusive of both
 *  endpoints (endpoints are day-anchored, so `end` covers its whole day). */
export function leadsInRange(leads: Lead[], startISO: string, endISO: string): Lead[] {
  const start = new Date(startISO); start.setHours(0, 0, 0, 0);
  const end = new Date(endISO); end.setHours(23, 59, 59, 999);
  const s = start.getTime();
  const e = end.getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return [];
  return leads.filter(l => {
    const t = new Date(l.created_at).getTime();
    return t >= s && t <= e;
  });
}

/** Adaptive buckets for a custom [start, end] range so the chart stays
 *  readable at any span: daily for <= 31 days, weekly for <= 366 days,
 *  monthly beyond that. Returns aligned counts + short labels. */
export function customBuckets(leads: Lead[], startISO: string, endISO: string):
  { counts: number[]; labels: string[] } {
  const start = new Date(startISO); start.setHours(0, 0, 0, 0);
  const end = new Date(endISO); end.setHours(0, 0, 0, 0);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { counts: [], labels: [] };
  }
  const spanDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  const inRange = leadsInRange(leads, startISO, endISO);

  const dayLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

  if (spanDays <= 31) {
    const counts = Array(spanDays).fill(0);
    const labels: string[] = [];
    for (let i = 0; i < spanDays; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      labels.push(dayLabel(d));
    }
    for (const l of inRange) {
      const d = new Date(l.created_at); d.setHours(0, 0, 0, 0);
      const idx = Math.floor((d.getTime() - start.getTime()) / 86400000);
      if (idx >= 0 && idx < spanDays) counts[idx]++;
    }
    return { counts, labels };
  }

  if (spanDays <= 366) {
    const weeks = Math.ceil(spanDays / 7);
    const counts = Array(weeks).fill(0);
    const labels: string[] = [];
    for (let i = 0; i < weeks; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i * 7);
      labels.push(dayLabel(d));
    }
    for (const l of inRange) {
      const d = new Date(l.created_at); d.setHours(0, 0, 0, 0);
      const idx = Math.floor((d.getTime() - start.getTime()) / (7 * 86400000));
      if (idx >= 0 && idx < weeks) counts[idx]++;
    }
    return { counts, labels };
  }

  // Monthly buckets across the span.
  const months: { y: number; m: number }[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push({ y: cursor.getFullYear(), m: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const counts = Array(months.length).fill(0);
  const labels = months.map(({ y, m }) => monthLabel(new Date(y, m, 1)));
  for (const l of inRange) {
    const d = new Date(l.created_at);
    const idx = months.findIndex(({ y, m }) => d.getFullYear() === y && d.getMonth() === m);
    if (idx !== -1) counts[idx]++;
  }
  return { counts, labels };
}

function tallyOutcomes(rows: Lead[]) {
  return {
    won: rows.filter(l => l.status === 'won').length,
    open: rows.filter(l => l.status === 'open').length,
    lost: rows.filter(l => l.status === 'lost').length,
    total: rows.length,
  };
}

/** Won/open/lost counts among leads created within the selected calendar
 *  period, so the outcome strip matches the headline count and the chart. */
export function outcomesInPeriod(leads: Lead[], range: Range, now = new Date()) {
  return tallyOutcomes(leadsInPeriod(leads, range, now));
}

/** Won/open/lost counts among leads created within an explicit [start, end]. */
export function outcomesInRange(leads: Lead[], startISO: string, endISO: string) {
  return tallyOutcomes(leadsInRange(leads, startISO, endISO));
}

export function scoreStats(leads: Lead[]) {
  const scored = leads.filter(l => l.score != null);
  // avg spans ALL scored leads (portfolio quality); hot is the action queue (open + uncontacted).
  const avg = scored.length ? Math.round(scored.reduce((a, l) => a + l.score!, 0) / scored.length) : 0;
  const hot = leads.filter(l => !l.contacted && l.status === 'open' && l.score != null)
    .sort((a, b) => b.score! - a.score!).slice(0, 5);
  return { avg, hot };
}
