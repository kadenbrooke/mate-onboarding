'use client';
import { useState, useEffect, useId } from 'react';
import { Card } from '../Card';
import { CalendarBlank } from '@phosphor-icons/react';
import {
  weekBars, monthBuckets, yearBuckets, customBuckets,
  outcomesInPeriod, outcomesInRange,
  type Range as PeriodRange,
} from '@/lib/metrics/leads';
import {
  brandVar, CARD_TRACK, CARD_MUTED, CARD_FG, CARD_CHIP, CARD_HAIRLINE, CARD_INSET,
  NUM_DISPLAY, NUM_TABLE, FONT_BODY, FREE_GREEN, LOST_BROWN,
} from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

// The Leads card shows lead volume over the selected calendar period. The
// three standard chips are calendar-to-date (this week Su..Sa, this month,
// this year); CUSTOM opens a date-range picker for any span. The headline
// number, caption, outcome strip, and chart all follow the same selection, and
// the chart marks themselves are hover/tap-scrubbable (like the RECOVERED
// card) so a client can read any single day's or period's value.

type Chip = PeriodRange | 'CUSTOM';
type ChartMode = 'bars' | 'line';

const CHIPS: Chip[] = ['WEEK', 'MONTH', 'YEAR', 'CUSTOM'];
const BAR_AREA_H = 56; // px height of the bar plotting area

/** Local yyyy-mm-dd for a native <input type="date"> value (no tz shift). */
function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDay(iso: string): string {
  // iso is yyyy-mm-dd; parse as local so the label matches the picker.
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function OutcomeStrip({ won, open, lost }: { won: number; open: number; lost: number }) {
  const items: { label: string; count: number; color: string }[] = [
    { label: 'won', count: won, color: FREE_GREEN },
    { label: 'open', count: open, color: brandVar },
    { label: 'lost', count: lost, color: LOST_BROWN },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      {items.map(it => (
        <span key={it.label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          border: `1.5px solid ${it.color}`, borderRadius: 999, padding: '3px 9px',
          fontSize: 11, fontFamily: FONT_BODY, color: it.color,
        }}>
          <span style={{ ...NUM_TABLE, color: 'inherit', fontWeight: 700 }}>{it.count}</span> {it.label}
        </span>
      ))}
    </div>
  );
}

/** Readout bubble shown at the hovered mark (value + its label). */
function Readout({ value, label, leftPct }: { value: number; label: string; leftPct?: number }) {
  return (
    <div
      data-testid="trend-readout"
      style={{
        position: 'absolute', top: -6,
        left: leftPct != null ? `${Math.min(85, Math.max(15, leftPct))}%` : undefined,
        right: leftPct == null ? 0 : undefined,
        transform: leftPct != null ? 'translateX(-50%)' : undefined,
        background: CARD_CHIP, borderRadius: 8, padding: '3px 8px',
        fontSize: 10, fontFamily: FONT_BODY, whiteSpace: 'nowrap',
        pointerEvents: 'none', color: CARD_FG, zIndex: 2,
      }}
    >
      <span style={{ fontWeight: 700 }}>{value}</span>
      <span style={{ color: CARD_MUTED }}> · {label}</span>
    </div>
  );
}

/** Vertical bar chart with hover/tap scrub. Used for WEEK and short custom
 *  spans. Preserves the px-height bars and per-bar testids the widget has
 *  always exposed. */
function ScrubBars({ series, labels }: { series: number[]; labels: string[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const max = Math.max(...series, 1);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || series.length === 0) return;
    const idx = Math.min(series.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * series.length)));
    setHi(idx);
  };
  const active = hi != null && series[hi] != null ? hi : null;
  return (
    <div style={{ position: 'relative', marginTop: 12 }}>
      {active != null && (
        <Readout value={series[active]} label={labels[active]} leftPct={((active + 0.5) / series.length) * 100} />
      )}
      <div
        data-testid="trend-bars"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHi(null)}
        style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: BAR_AREA_H + 16, touchAction: 'pan-y' }}
      >
        {series.map((count, i) => {
          const h = count > 0 ? Math.max(6, (count / max) * BAR_AREA_H) : 6;
          const isActive = active === i;
          return (
            <div key={labels[i] ?? i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
              <div
                data-testid={`trend-bar-${labels[i]}`}
                data-count={count}
                style={{
                  width: '100%',
                  height: h,
                  background: count > 0 ? brandVar : CARD_TRACK,
                  borderRadius: count > 0 ? '5px 5px 2px 2px' : 3,
                  opacity: active == null || isActive ? 1 : 0.45,
                  transition: 'opacity 120ms',
                }}
              />
              <span style={{ fontSize: 9, color: isActive ? CARD_FG : CARD_MUTED, fontFamily: FONT_BODY }}>{labels[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Area sparkline with a RECOVERED-style crosshair scrub. Used for MONTH,
 *  YEAR, and long custom spans. */
function ScrubLine({ series, labels }: { series: number[]; labels: string[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const rawId = useId();
  const gradId = `trend-grad-${rawId.replace(/:/g, '')}`;
  const max = Math.max(...series, 1);
  const W = 220;
  const H = 52;
  const n = series.length;
  const pts = series.map((c, i) => {
    const x = n <= 1 ? W / 2 : (i / (n - 1)) * W;
    const y = H - 2 - (c / max) * (H - 6);
    return { x, y };
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || n === 0) return;
    const idx = Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
    setHi(idx);
  };
  const hover = hi != null && pts[hi]
    ? { xPct: (pts[hi].x / W) * 100, yPct: (pts[hi].y / H) * 100, value: series[hi], label: labels[hi] }
    : null;
  return (
    <div
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHi(null)}
      style={{ position: 'relative', marginTop: 12, touchAction: 'pan-y' }}
    >
      <svg
        data-testid="trend-spark"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={brandVar} stopOpacity={0.3} />
            <stop offset="100%" stopColor={brandVar} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={brandVar} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {hover && (
        <>
          <div aria-hidden style={{
            position: 'absolute', left: `${hover.xPct}%`, top: `${hover.yPct}%`, bottom: 0,
            width: 1, background: CARD_HAIRLINE, transform: 'translateX(-0.5px)', pointerEvents: 'none',
          }} />
          <div aria-hidden style={{
            position: 'absolute', left: `${hover.xPct}%`, top: `${hover.yPct}%`,
            width: 9, height: 9, borderRadius: '50%',
            background: 'var(--card-bg, #ffffff)', border: `2px solid ${brandVar}`,
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
          <Readout value={hover.value} label={hover.label} leftPct={hover.xPct} />
        </>
      )}
    </div>
  );
}

export function TrendCard({ leads }: { leads: Lead[] }) {
  const [chip, setChip] = useState<Chip>('WEEK');
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Custom range state, persisted in the component only. Defaults to the last
  // 30 days (inclusive of today) when CUSTOM is first opened.
  const [customStart, setCustomStart] = useState(() => {
    const s = new Date(); s.setDate(s.getDate() - 29); return toDateInput(s);
  });
  const [customEnd, setCustomEnd] = useState(() => toDateInput(new Date()));

  const now = new Date();

  // Resolve the active selection into a series, aligned labels, chart mode,
  // headline count, caption, and outcome tally. Headline == sum(series) so the
  // number always matches what the chart draws.
  let series: number[];
  let labels: string[];
  let mode: ChartMode;
  let caption: string;
  let outcomes: { won: number; open: number; lost: number; total: number };

  if (chip === 'CUSTOM') {
    const built = customBuckets(leads, customStart, customEnd);
    series = built.counts;
    labels = built.labels;
    const startMs = new Date(`${customStart}T00:00:00`).getTime();
    const endMs = new Date(`${customEnd}T00:00:00`).getTime();
    const spanDays = Number.isNaN(startMs) || Number.isNaN(endMs)
      ? 0
      : Math.floor((endMs - startMs) / 86400000) + 1;
    mode = spanDays > 0 && spanDays <= 31 ? 'bars' : 'line';
    caption = `${fmtDay(customStart)} to ${fmtDay(customEnd)}`;
    outcomes = outcomesInRange(leads, customStart, customEnd);
  } else if (chip === 'WEEK') {
    const bars = weekBars(leads, now);
    series = bars.map(b => b.count);
    labels = bars.map(b => b.day);
    mode = 'bars';
    caption = 'this week';
    outcomes = outcomesInPeriod(leads, 'WEEK', now);
  } else if (chip === 'MONTH') {
    series = monthBuckets(leads, now);
    labels = series.map((_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    mode = 'line';
    caption = 'this month';
    outcomes = outcomesInPeriod(leads, 'MONTH', now);
  } else {
    series = yearBuckets(leads, now);
    labels = series.map((_, i) => new Date(now.getFullYear(), i, 1)
      .toLocaleDateString('en-US', { month: 'short' }));
    mode = 'line';
    caption = 'this year';
    outcomes = outcomesInPeriod(leads, 'YEAR', now);
  }

  const headline = series.reduce((a, b) => a + b, 0);

  const right = (
    <div style={{ display: 'flex', gap: 4 }}>
      {CHIPS.map(c => {
        const activeChip = chip === c;
        return (
          <button
            key={c}
            aria-label={c}
            className="dash-tap"
            onClick={() => setChip(c)}
            onMouseEnter={() => setChip(c)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10,
              letterSpacing: 1,
              padding: '5px 10px',
              borderRadius: 99,
              border: 'none',
              cursor: 'pointer',
              background: activeChip ? brandVar : CARD_TRACK,
              color: activeChip ? '#fff' : CARD_MUTED,
              fontWeight: activeChip ? 700 : 400,
              fontFamily: FONT_BODY,
            }}
          >
            {c === 'CUSTOM' ? <CalendarBlank size={11} weight="bold" aria-hidden /> : null}
            {c === 'CUSTOM' ? 'CUSTOM' : c}
          </button>
        );
      })}
    </div>
  );

  const dateInputStyle: React.CSSProperties = {
    fontFamily: FONT_BODY, fontSize: 11.5, color: CARD_FG,
    background: CARD_INSET, border: `1px solid ${CARD_HAIRLINE}`,
    borderRadius: 8, padding: '5px 8px', colorScheme: 'light',
  };

  const chartBody = (() => {
    if (!mounted) {
      // Fixed-height placeholder so SSR never disagrees with the client.
      return <div style={{ height: 68 }} />;
    }
    if (chip === 'CUSTOM' && series.length === 0) {
      return (
        <div style={{ height: 68, display: 'flex', alignItems: 'center', color: CARD_MUTED, fontSize: 12, fontFamily: FONT_BODY }}>
          Pick a start and end date to see leads for that range.
        </div>
      );
    }
    if (mode === 'bars') {
      return <ScrubBars key={`bars-${chip}-${customStart}-${customEnd}`} series={series} labels={labels} />;
    }
    return <ScrubLine key={`line-${chip}-${customStart}-${customEnd}`} series={series} labels={labels} />;
  })();

  return (
    <Card label="LEADS" right={right}>
      {/* Standalone display stat: Geist 300 pnum per brand guide. Follows the
          selected calendar period (or custom range). */}
      <div style={{ fontSize: 28, marginTop: 6, ...NUM_DISPLAY }}>{headline}</div>
      <div style={{ fontSize: 11, color: CARD_MUTED, fontFamily: FONT_BODY, marginTop: 1 }}>{caption}</div>

      {chip === 'CUSTOM' && mounted && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input
            type="date"
            aria-label="Start date"
            value={customStart}
            max={customEnd}
            onChange={(e) => setCustomStart(e.target.value)}
            style={dateInputStyle}
          />
          <span style={{ fontSize: 11, color: CARD_MUTED, fontFamily: FONT_BODY }}>to</span>
          <input
            type="date"
            aria-label="End date"
            value={customEnd}
            min={customStart}
            max={toDateInput(new Date())}
            onChange={(e) => setCustomEnd(e.target.value)}
            style={dateInputStyle}
          />
        </div>
      )}

      {/* Won/open/lost for the selected period: volume vs outcome in one glance,
          without pulling in the all-time funnel below. */}
      <OutcomeStrip won={outcomes.won} open={outcomes.open} lost={outcomes.lost} />
      {chartBody}
    </Card>
  );
}
