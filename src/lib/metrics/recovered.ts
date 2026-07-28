import type { Lead } from './leads';

// ---------------------------------------------------------------------------
// Recovered-$ interactive area chart (Mercury-style) -- pure math layer.
// Daily cumulative series, WoW dollar delta, monotone-cubic path generation,
// and crosshair hit mapping. All rendering lives in RecoveredCard.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type DailyPoint = { date: string; cents: number };

/** Start of the local calendar day for a date. */
function dayStart(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/**
 * Cumulative recovered-$ per day over the trailing `days` window (oldest
 * first, today last). Each point carries the running total INCLUDING wins
 * before the window, so the last point equals total recovered to date.
 */
export function recoveredDailySeries(leads: Lead[], days = 30, now = new Date()): DailyPoint[] {
  const todayStart = dayStart(now);
  const windowStart = todayStart - (days - 1) * DAY_MS;

  let base = 0;
  const perDay = Array<number>(days).fill(0);
  for (const l of leads) {
    if (l.status !== 'won') continue;
    const cents = l.quote_cents ?? 0;
    const t = dayStart(new Date(l.created_at));
    if (t < windowStart) base += cents;
    else if (t <= todayStart) perDay[Math.round((t - windowStart) / DAY_MS)] += cents;
  }

  const points: DailyPoint[] = [];
  let cum = base;
  for (let i = 0; i < days; i++) {
    cum += perDay[i];
    points.push({ date: new Date(windowStart + i * DAY_MS).toISOString(), cents: cum });
  }
  return points;
}

/** Recovered-$ this trailing week minus the week before, in cents. */
export function recoveredWowDeltaCents(leads: Lead[], now = new Date()): number {
  const t = now.getTime();
  let cur = 0;
  let prev = 0;
  for (const l of leads) {
    if (l.status !== 'won') continue;
    const age = t - new Date(l.created_at).getTime();
    if (age < 0) continue;
    if (age < WEEK_MS) cur += l.quote_cents ?? 0;
    else if (age < 2 * WEEK_MS) prev += l.quote_cents ?? 0;
  }
  return cur - prev;
}

/** "$4,659.76" split for the cents-superscript treatment. */
export function splitDollarsCents(cents: number): { dollars: string; cents: string } {
  const safe = Math.max(0, Math.round(cents));
  return {
    dollars: Math.floor(safe / 100).toLocaleString('en-US'),
    cents: (safe % 100).toString().padStart(2, '0'),
  };
}

/** Evenly spaced tick indexes for sparse x-axis labels (first + last included). */
export function sparseTickIndexes(n: number, count = 5): number[] {
  if (n <= 0) return [];
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: count }, (_, i) => Math.round((i / (count - 1)) * (n - 1)));
}

export type XY = { x: number; y: number };

/**
 * Scale a series into chart space: x spread across [0, w], y inverted with
 * padding so the line never kisses the card edges. Flat series sit low.
 */
export function scaleSeries(values: number[], w: number, h: number, padTop = 6, padBottom = 4): XY[] {
  const n = values.length;
  if (n === 0) return [];
  const max = Math.max(...values, 1);
  return values.map((v, i) => ({
    x: n === 1 ? w / 2 : (i / (n - 1)) * w,
    y: h - padBottom - (v / max) * (h - padTop - padBottom),
  }));
}

/**
 * Monotone cubic interpolation (Fritsch-Carlson) rendered as SVG cubic
 * beziers. No overshoot: the curve never dips below/above its data, which
 * matters for a cumulative money series.
 */
export function monotonePath(pts: XY[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x},${pts[0].y}`;

  // Secant slopes
  const dx = Array<number>(n - 1);
  const dy = Array<number>(n - 1);
  const m = Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  // Tangents
  const t = Array<number>(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }
  // Clamp tangents to preserve monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
    } else {
      const a = t[i] / m[i];
      const b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const scale = 3 / Math.sqrt(s);
        t[i] = scale * a * m[i];
        t[i + 1] = scale * b * m[i];
      }
    }
  }

  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3;
    const c1x = pts[i].x + third;
    const c1y = pts[i].y + t[i] * third;
    const c2x = pts[i + 1].x - third;
    const c2y = pts[i + 1].y - t[i + 1] * third;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

/** Close a line path into an area down to the baseline at `h`. */
export function areaPath(line: string, pts: XY[], h: number): string {
  if (pts.length === 0 || !line) return '';
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${line} L ${last.x.toFixed(2)},${h} L ${first.x.toFixed(2)},${h} Z`;
}

/** Nearest point index for a pointer x expressed as a fraction [0..1]. */
export function nearestIndexForFraction(frac: number, n: number): number {
  if (n <= 1) return 0;
  const clamped = Math.min(1, Math.max(0, frac));
  return Math.round(clamped * (n - 1));
}
