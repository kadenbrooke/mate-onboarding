export type Lead = {
  id: string; name: string | null; city: string | null; service: string | null;
  source: 'missed_call' | 'texted_in' | 'web_form' | 'referral' | 'revived' | 'unknown';
  referrer_name: string | null; score: number | null;
  status: 'open' | 'won' | 'lost'; quote_cents: number | null;
  contacted: boolean; after_hours: boolean; first_reply_seconds: number | null;
  created_at: string;
};

const FREE_SOURCES = new Set(['referral', 'revived']);

function startOfWeek(now = new Date()): Date {
  const day = (now.getDay() + 6) % 7; // Mon = 0
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - day);
  return monday;
}

function localDayKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function weekBars(leads: Lead[], now = new Date()) {
  // Local-calendar week, Monday start. Runs in the browser so "week" means the
  // client's local week; server prerender may briefly show UTC buckets (charts
  // mount-gate to avoid hydration mismatch).
  const monday = startOfWeek(now);
  const dayKeys: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    dayKeys.push(localDayKey(d));
  }
  const bars = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(day => ({ day, count: 0 }));
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

export function scoreStats(leads: Lead[]) {
  const scored = leads.filter(l => l.score != null);
  // avg spans ALL scored leads (portfolio quality); hot is the action queue (open + uncontacted).
  const avg = scored.length ? Math.round(scored.reduce((a, l) => a + l.score!, 0) / scored.length) : 0;
  const hot = leads.filter(l => !l.contacted && l.status === 'open' && l.score != null)
    .sort((a, b) => b.score! - a.score!).slice(0, 5);
  return { avg, hot };
}
