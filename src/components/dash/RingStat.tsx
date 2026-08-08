'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ringSegments } from '@/lib/metrics/ring';
import { CARD_TRACK, CARD_MUTED, NUM_TABLE, FONT_NUM, FONT_BODY } from '@/lib/theme';

// RingStat -- the ONE donut pattern for the whole dashboard.
//
// Every ring on the dashboard renders through this: a segmented ring BESIDE an
// always-visible labeled legend (swatch + label + value per segment, readable
// at a glance, matching the leadflow SourceDonut markup) PLUS the locked
// TwinRings center-swap (hovering/tapping a segment -- or its legend row --
// shows that segment in the center; leaving / re-tapping returns to the resting
// center). Both behaviours together, not either/or.
//
// The center only ever renders ONE provided value at a time (a focused segment,
// or the resting `center`). It never sums segments, so a ring whose parts are
// different-period measures (e.g. collected vs outstanding) stays a comparative
// gauge, never a false total. The resting center is also free to be an
// aggregate that is not itself a segment (e.g. SourceDonut's FREE count).
//
// Geometry is SourceDonut's (r=40, strokeWidth 12, 100x100 viewBox) so all
// rings read as siblings. Zero / all-zero inputs degrade gracefully:
// `ringSegments` yields zero-length dashes (no NaN, no negative arcs) and the
// bare track circle shows through.

const R = 40;
const GAP_DEG = 2;
const CIRC = 2 * Math.PI * R;

export type RingStatSegment = {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Formatted value for legend + center. Defaults to String(value). */
  display?: string;
  /** Arc-length source; defaults to `value`. Use to clamp negatives to 0 so a
   *  negative segment can't make a negative-length arc. */
  arcValue?: number;
  /** Center sub-line shown while this segment is focused. */
  sub?: string;
  /** Extra text appended in the legend row (e.g. "3 invoices"). */
  legendSub?: string;
};

export type RingStatCenter = {
  label: string;
  display: string;
  color: string;
  sub?: string;
};

export function RingStat({
  idPrefix, segments, center, ariaLabel, size = 104, caption, aside,
}: {
  idPrefix: string;
  segments: RingStatSegment[];
  /** Resting center (shown with no segment focused). */
  center: RingStatCenter;
  ariaLabel: string;
  size?: number;
  /** Small heading above the legend (distinguishes sibling rings, e.g. REVENUE / LEADS). */
  caption?: string;
  /** Extra content rendered under the legend (e.g. an adjacent hero number). */
  aside?: ReactNode;
}) {
  const [focus, setFocus] = useState<string | null>(null);

  const segs = ringSegments(
    segments.map(s => ({ key: s.key, value: Math.max(0, s.arcValue ?? s.value) })),
    R,
    GAP_DEG,
  );

  const focused = focus ? segments.find(s => s.key === focus) ?? null : null;
  const shown: RingStatCenter = focused
    ? { display: focused.display ?? String(focused.value), label: focused.label, color: focused.color, sub: focused.sub }
    : center;
  const hasSub = Boolean(shown.sub);

  const toggle = (key: string) => setFocus(f => (f === key ? null : key));

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
      onMouseLeave={() => setFocus(null)}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }} role="img" aria-label={ariaLabel}>
        <g transform="translate(50,50) rotate(-90)">
          <circle r={R} fill="none" stroke={CARD_TRACK} strokeWidth={12} />
          {segs.map(s => {
            const seg = segments.find(x => x.key === s.key)!;
            return (
              <circle
                key={s.key}
                data-testid={`${idPrefix}-seg-${s.key}`}
                r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth={focus === s.key ? 14 : 12}
                strokeLinecap="round"
                strokeDasharray={`${s.dash} ${CIRC}`}
                strokeDashoffset={s.offset}
                style={{ cursor: 'pointer' }}
                onClick={() => toggle(s.key)}
                onMouseEnter={() => setFocus(s.key)}
              />
            );
          })}
        </g>
        {/* Center: Geist 300 pnum standalone display stat, like SourceDonut. */}
        <text
          data-testid={`${idPrefix}-center`}
          x={50}
          y={hasSub ? 44 : 47}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={19}
          fontWeight={300}
          fontFamily={FONT_NUM}
          fill={shown.color}
        >
          {shown.display}
        </text>
        <text x={50} y={hasSub ? 58 : 61} textAnchor="middle" fontSize={8} letterSpacing={1} fontFamily={FONT_BODY} fill={shown.color}>
          {shown.label}
        </text>
        {hasSub && (
          <text data-testid={`${idPrefix}-center-sub`} x={50} y={69} textAnchor="middle" fontSize={6.5} fontFamily={FONT_BODY} fill={CARD_MUTED}>
            {shown.sub}
          </text>
        )}
      </svg>

      {/* Persistent legend: swatch + label + value per segment, always visible.
          Each row is also a tap/hover target that swaps the center. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {caption && (
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: CARD_MUTED, fontFamily: FONT_BODY, marginBottom: 2 }}>
            {caption}
          </div>
        )}
        {segments.map(s => (
          <button
            key={s.key}
            type="button"
            data-testid={`${idPrefix}-legend-${s.key}`}
            onClick={() => toggle(s.key)}
            onMouseEnter={() => setFocus(s.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 10,
              background: 'none', border: 'none', padding: 0, margin: 0,
              cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'inherit',
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ color: CARD_MUTED, fontFamily: FONT_BODY }}>
              {s.label}
              {' '}
              <span style={{ ...NUM_TABLE }}>{s.display ?? String(s.value)}</span>
              {s.legendSub && <span style={{ fontSize: 8.5 }}> &middot; {s.legendSub}</span>}
            </span>
          </button>
        ))}
        {aside}
      </div>
    </div>
  );
}
