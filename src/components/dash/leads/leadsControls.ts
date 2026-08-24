import type { Lead, LeadStatus, StageStatus } from '@/lib/metrics/leads';
import { normalizeHandler } from './driverToggle';

export type SortKey = 'location' | 'score' | 'status' | 'quote' | 'captured' | 'driver';
export type SortDir = 'asc' | 'desc';
export interface SortEntry { key: SortKey; dir: SortDir }

/** First-click direction per chip. Founder intent: score & quote high->low,
 *  status in pipeline order (open > booked > quoted > serviced, asc rank),
 *  location A->Z, captured newest->oldest, driver agent->human (A->Z). */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  location: 'asc', score: 'desc', status: 'asc', quote: 'desc',
  captured: 'desc', driver: 'asc',
};

const STATUS_RANK: Record<LeadStatus, number> = { open: 0, booked: 1, quoted: 2, serviced: 3 };

/** Toggle semantics for the Booked/Quoted/Serviced stage control. Clicking the
 *  stage that is already set clears it back to the neutral 'open' state (the
 *  schema's no-stage value); clicking a different stage moves straight to it,
 *  in either direction -- an operator who mis-taps Serviced must be able to
 *  walk it back to Booked without an intermediate step. */
export function nextStatus(current: LeadStatus, clicked: StageStatus): LeadStatus {
  return current === clicked ? 'open' : clicked;
}

/** Substring match across the human-facing columns. */
export function searchLeads(leads: Lead[], query: string): Lead[] {
  const q = query.trim().toLowerCase();
  if (!q) return leads;
  return leads.filter(l =>
    [l.name, l.service, l.city, l.phone, l.email, l.address, l.source]
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

/** created_at as epoch ms; null/absent/invalid become -1 (mirrors the score/quote
 *  `?? -1` idiom) so they read as oldest -> land last under the default desc
 *  (newest-first) direction, and never produce NaN in the comparator. */
function capturedMs(l: Lead): number {
  if (!l.created_at) return -1;
  const t = new Date(l.created_at).getTime();
  return Number.isNaN(t) ? -1 : t;
}

function compareBy(key: SortKey, a: Lead, b: Lead): number {
  switch (key) {
    case 'location': return (a.city ?? '').localeCompare(b.city ?? '');
    case 'score':    return (a.score ?? -1) - (b.score ?? -1);
    case 'quote':    return (a.quote_cents ?? -1) - (b.quote_cents ?? -1);
    case 'status':   return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    case 'captured': return capturedMs(a) - capturedMs(b);
    // Sort by the DRIVER column's displayed value (agent/human), so null/legacy
    // handlers normalize to 'agent' and group with real agents instead of
    // dangling as a separate empty bucket. 'agent' < 'human' ascending.
    case 'driver':   return normalizeHandler(a.handler).localeCompare(normalizeHandler(b.handler));
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
  { key: 'captured', label: 'Date captured' },
  { key: 'driver', label: 'Driver' },
];

/** Read a sort intent off the URL (`?sort=captured&dir=desc`). Lets a caller
 *  deep-link the pipeline in a specific order -- the NEW LEADS glance tile
 *  links to `?sort=captured`, i.e. newest captured first. Unknown key or bad
 *  dir returns null, so a hand-typed URL falls back to the table's default
 *  sort instead of erroring. */
export function parseSortParam(sort?: string, dir?: string): SortEntry[] | null {
  if (!sort || !SORT_KEYS.has(sort)) return null;
  const key = sort as SortKey;
  const direction: SortDir = dir === 'asc' || dir === 'desc' ? dir : DEFAULT_DIR[key];
  return [{ key, dir: direction }];
}

// --- Controls persistence -------------------------------------------------
// Opening a lead's thread navigates to ?spotlight=<id>, which re-renders the
// page and remounts the table -- without persistence that navigation wiped the
// search box and sort chips every time. Controls are stored per session in
// sessionStorage: they survive the thread round-trip (and back/forward) but
// reset on a fresh visit, so a stale week-old search can't silently hide leads.
// Restore happens in a mount effect, never in the useState initializer, so the
// SSR and first client render agree (same hydration posture as useDashLayout).

export interface LeadsControls { query: string; sort: SortEntry[] }

const CONTROLS_PREFIX = 'mate:pipeline:controls:v1:';
const controlsKey = (sessionId: string) => CONTROLS_PREFIX + sessionId;

const SORT_KEYS = new Set<string>(SORT_CHIPS.map(c => c.key));

function isSortEntry(v: unknown): v is SortEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.key === 'string' && SORT_KEYS.has(o.key) && (o.dir === 'asc' || o.dir === 'desc');
}

/** Parse stored controls; null when absent, corrupt, or storage unavailable. */
export function loadControls(sessionId: string): LeadsControls | null {
  try {
    const raw = window.sessionStorage.getItem(controlsKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.query !== 'string' || !Array.isArray(parsed.sort) || !parsed.sort.every(isSortEntry)) {
      return null;
    }
    // Dedupe by key defensively: applySort trusts entry order.
    const seen = new Set<string>();
    const sort = (parsed.sort as SortEntry[]).filter(e => !seen.has(e.key) && seen.add(e.key));
    return { query: parsed.query, sort };
  } catch {
    return null; // private mode / bad JSON: fall back to defaults, never crash
  }
}

export function saveControls(sessionId: string, controls: LeadsControls): void {
  try {
    window.sessionStorage.setItem(controlsKey(sessionId), JSON.stringify(controls));
  } catch {
    /* storage unavailable: session-only, no-op */
  }
}
