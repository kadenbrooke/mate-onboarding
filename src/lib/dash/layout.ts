// Movable/resizable dashboard layout: persistence + geometry helpers.
//
// The client dashboard's desktop zone area is a react-grid-layout grid. Each
// movable card carries a stable string id (`zone-*`, matching the existing
// SectionCard scroll-anchor ids). A client's custom arrangement is stored
// per-device in localStorage; clearing it restores the founder-designed
// default. The `v1` in the key lets a future breaking layout change invalidate
// old stored layouts by bumping the version.

/** One grid item: id + grid coordinates in column/row units. */
export interface DashLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export type DashLayout = DashLayoutItem[];

/** Grid geometry, shared by the grid and the height-measurement pass. */
export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT = 10;
export const GRID_MARGIN = 10;

const STORAGE_PREFIX = 'mate:dash:layout:v1:';
const storageKey = (sessionId: string) => STORAGE_PREFIX + sessionId;

function isLayoutItem(v: unknown): v is DashLayoutItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.i === 'string' &&
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.w === 'number' &&
    typeof o.h === 'number'
  );
}

/** True only for a non-empty array of well-formed layout items. */
export function isValidLayout(v: unknown): v is DashLayout {
  return Array.isArray(v) && v.length > 0 && v.every(isLayoutItem);
}

/** Read a stored layout; null when absent, corrupt, or storage is unavailable. */
export function loadLayout(sessionId: string): DashLayout | null {
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidLayout(parsed) ? parsed : null;
  } catch {
    return null; // private mode / bad JSON: fall back to default, never crash
  }
}

export function saveLayout(sessionId: string, layout: DashLayout): void {
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(layout));
  } catch {
    /* storage unavailable: session-only, no-op */
  }
}

export function clearLayout(sessionId: string): void {
  try {
    window.localStorage.removeItem(storageKey(sessionId));
  } catch {
    /* no-op */
  }
}

// --- Mobile stack order (reorder-only) -------------------------------------
// Each mobile tab is a vertical list; a client's custom order is stored as an
// array of card ids keyed per session + stack (tab).

const ORDER_PREFIX = 'mate:dash:order:v1:';
const orderKey = (sessionId: string, stackId: string) =>
  `${ORDER_PREFIX}${sessionId}:${stackId}`;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Read a stored stack order; null when absent/corrupt/unavailable. */
export function loadOrder(sessionId: string, stackId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(orderKey(sessionId, stackId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveOrder(sessionId: string, stackId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(orderKey(sessionId, stackId), JSON.stringify(ids));
  } catch {
    /* no-op */
  }
}

export function clearOrder(sessionId: string, stackId: string): void {
  try {
    window.localStorage.removeItem(orderKey(sessionId, stackId));
  } catch {
    /* no-op */
  }
}

/**
 * Reconcile a stored order against the current card set: keep stored positions
 * for ids that still exist, drop ids that vanished, append newly-added cards at
 * the end. Guarantees the rendered order always covers exactly `defaults`.
 */
export function mergeOrder(stored: string[], defaults: string[]): string[] {
  const present = new Set(defaults);
  const kept = stored.filter((id) => present.has(id));
  const keptSet = new Set(kept);
  const appended = defaults.filter((id) => !keptSet.has(id));
  return [...kept, ...appended];
}

/** Convert a measured pixel height into whole grid rows (RGL row math). */
export function pxToRows(px: number): number {
  return Math.max(1, Math.ceil((px + GRID_MARGIN) / (GRID_ROW_HEIGHT + GRID_MARGIN)));
}

/** Pixel width of a `w`-column item given the container width (containerPadding 0). */
export function colSpanPx(containerWidth: number, w: number): number {
  const colWidth = (containerWidth - GRID_MARGIN * (GRID_COLS - 1)) / GRID_COLS;
  return w * colWidth + (w - 1) * GRID_MARGIN;
}
