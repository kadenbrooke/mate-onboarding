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

export function weekBars(leads: Lead[], now = new Date()) {
  const monday = startOfWeek(now);
  const bars = Array.from({ length: 7 }, (_, i) => ({
    day: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i], count: 0,
  }));
  for (const l of leads) {
    const idx = Math.floor((new Date(l.created_at).getTime() - monday.getTime()) / 86400_000);
    if (idx >= 0 && idx < 7) bars[idx].count++;
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
  const sum = (status: Lead['status']) =>
    leads.filter(l => l.status === status).reduce((a, l) => a + (l.quote_cents ?? 0), 0);
  const count = (status: Lead['status']) => leads.filter(l => l.status === status).length;
  const counts = { won: count('won'), lost: count('lost'), open: count('open') };
  const settled = counts.won + counts.lost;
  return {
    wonCents: sum('won'), lostCents: sum('lost'), openCents: sum('open'), counts,
    winRate: settled === 0 ? 0 : Math.round((counts.won / settled) * 100),
  };
}

export function valueWheel(leads: Lead[]) {
  const byService = new Map<string, Lead[]>();
  for (const l of leads) {
    const key = l.service ?? 'Other';
    byService.set(key, [...(byService.get(key) ?? []), l]);
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
  const avg = scored.length ? Math.round(scored.reduce((a, l) => a + l.score!, 0) / scored.length) : 0;
  const hot = leads.filter(l => !l.contacted && l.status === 'open' && l.score != null)
    .sort((a, b) => b.score! - a.score!).slice(0, 5);
  return { avg, hot };
}
