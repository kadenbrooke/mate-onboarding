import type { Lead } from '@/lib/metrics/leads';

export type SortKey = 'location' | 'score' | 'status' | 'quote';
export type SortDir = 'asc' | 'desc';
export interface SortEntry { key: SortKey; dir: SortDir }

/** First-click direction per chip. Founder intent: score & quote high->low,
 *  status open>won>lost (asc rank), location A->Z. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  location: 'asc', score: 'desc', status: 'asc', quote: 'desc',
};

const STATUS_RANK: Record<Lead['status'], number> = { open: 0, won: 1, lost: 2 };

/** Substring match across the human-facing columns. */
export function searchLeads(leads: Lead[], query: string): Lead[] {
  const q = query.trim().toLowerCase();
  if (!q) return leads;
  return leads.filter(l =>
    [l.name, l.service, l.city, l.phone, l.source]
      .some(v => (v ?? '').toString().toLowerCase().includes(q)),
  );
}

/** 3-state cycle per chip: absent -> default dir -> flipped dir -> absent.
 *  Active chips keep activation order so applySort can use them as a
 *  compound (primary, secondary, ...) sort. */
export function cycleSort(state: SortEntry[], key: SortKey): SortEntry[] {
  const idx = state.findIndex(e => e.key === key);
  if (idx === -1) return [...state, { key, dir: DEFAULT_DIR[key] }];
  const cur = state[idx];
  const flipped: SortDir = DEFAULT_DIR[key] === 'desc' ? 'asc' : 'desc';
  if (cur.dir === DEFAULT_DIR[key]) {
    return state.map(e => (e.key === key ? { key, dir: flipped } : e));
  }
  return state.filter(e => e.key !== key);
}

function compareBy(key: SortKey, a: Lead, b: Lead): number {
  switch (key) {
    case 'location': return (a.city ?? '').localeCompare(b.city ?? '');
    case 'score':    return (a.score ?? -1) - (b.score ?? -1);
    case 'quote':    return (a.quote_cents ?? -1) - (b.quote_cents ?? -1);
    case 'status':   return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  }
}

/** Stable compound sort over active chips in priority order. Non-mutating. */
export function applySort(leads: Lead[], state: SortEntry[]): Lead[] {
  if (state.length === 0) return leads;
  return [...leads].sort((a, b) => {
    for (const { key, dir } of state) {
      const cmp = compareBy(key, a, b);
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

export const SORT_CHIPS: { key: SortKey; label: string }[] = [
  { key: 'location', label: 'Location' },
  { key: 'score', label: 'Score' },
  { key: 'status', label: 'Status' },
  { key: 'quote', label: 'Quote' },
];
