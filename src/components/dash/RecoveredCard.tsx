'use client';
import { useId, useState } from 'react';
import { CurrencyDollar, ArrowUpRight, ArrowDownRight } from '@phosphor-icons/react';
import { moneyShort } from '@/lib/metrics/format';
import {
  splitDollarsCents, sparseTickIndexes, scaleSeries, monotonePath, areaPath,
  nearestIndexForFraction, type DailyPoint,
} from '@/lib/metrics/recovered';
import { useCountUp } from './useCountUp';
import {
  NUM_DISPLAY, FONT_BODY, brandVar, BG_DARK_CARD, CARD_SHADOW,
  SCORE_GREEN, SCORE_RED,
} from '@/lib/theme';

// Mercury-style interactive area chart: the page's single dark accent card.
// Big number with cents superscript, WoW dollar delta, smooth monotone curve
// with a gradient fade, hover/touch crosshair, sparse x-axis date labels.

const LIGHT = '#ede6e6';
const LIGHT_DIM = 'rgba(237,230,230,0.6)';
const HAIRLINE = 'rgba(237,230,230,0.14)';

/** viewBox space; the svg stretches, strokes stay uniform via vector-effect. */
const VW = 100;
const VH = 100;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function RecoveredCard({ totalCents, roiMultiple, deltaCents, points }: {
  totalCents: number;
  roiMultiple: number;
  deltaCents: number;
  points: DailyPoint[];
}) {
  const rawId = useId();
  const gradId = `rec-grad-${rawId.replace(/:/g, '')}`;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const animated = useCountUp(totalCents);
  const { dollars, cents } = splitDollarsCents(animated);

  const pts = scaleSeries(points.map(p => p.cents), VW, VH, 10, 4);
  const line = monotonePath(pts);
  const area = areaPath(line, pts, VH);
  const ticks = sparseTickIndexes(points.length, 5);

  const hover = hoverIdx != null && pts[hoverIdx] ? {
    xPct: pts[hoverIdx].x,
    yPct: pts[hoverIdx].y,
    point: points[hoverIdx],
  } : null;

  const up = deltaCents >= 0;
  const DeltaArrow = up ? ArrowUpRight : ArrowDownRight;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || points.length === 0) return;
    setHoverIdx(nearestIndexForFraction((e.clientX - rect.left) / rect.width, points.length));
  };

  return (
    <div style={{
      flex: 1.6, minWidth: 260, borderRadius: 16, padding: 16,
      background: BG_DARK_CARD, color: LIGHT, boxShadow: CARD_SHADOW,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header: icon chip + label, WoW dollar delta right-aligned */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span aria-hidden style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.1)', color: brandVar,
          }}>
            <CurrencyDollar size={16} weight="bold" />
          </span>
          <span style={{
            fontSize: 11, letterSpacing: 1.5, fontWeight: 600, fontFamily: FONT_BODY,
            color: 'rgba(237,230,230,0.65)', whiteSpace: 'nowrap',
          }}>
            RECOVERED
          </span>
        </div>
        <span data-testid="recovered-delta" style={{
          display: 'inline-flex', alignItems: 'center', gap: 2,
          fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
          color: up ? SCORE_GREEN : SCORE_RED,
          background: 'rgba(255,255,255,0.08)', borderRadius: 99, padding: '3px 8px',
        }}>
          <DeltaArrow size={11} weight="bold" aria-hidden />
          {moneyShort(Math.abs(deltaCents))}
        </span>
      </div>

      {/* Big number: cents rendered superscript, Mercury style */}
      <div style={{ marginTop: 10, lineHeight: 1 }}>
        <span style={{ fontSize: 32, ...NUM_DISPLAY }}>${dollars}</span>
        <span style={{
          fontSize: 16, ...NUM_DISPLAY,
          verticalAlign: 'super', marginLeft: 1, color: LIGHT_DIM,
        }}>
          .{cents}
        </span>
      </div>
      <div style={{ fontSize: 11, fontFamily: FONT_BODY, marginTop: 5, color: LIGHT_DIM }}>
        {points.length > 0 ? longDate(points[points.length - 1].date) : ''}
        {roiMultiple > 0 ? ` · ${roiMultiple.toFixed(1)}x what you pay` : ''}
      </div>

      {/* Chart + crosshair overlay */}
      <div
        data-testid="recovered-chart"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHoverIdx(null)}
        style={{ position: 'relative', marginTop: 'auto', paddingTop: 10, height: 96, touchAction: 'pan-y' }}
      >
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          style={{ display: 'block' }}
          aria-hidden
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={brandVar} stopOpacity={0.32} />
              <stop offset="100%" stopColor={brandVar} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradId})`} />
          <path
            d={line}
            fill="none"
            stroke={brandVar}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {hover && (
          <>
            {/* Vertical drop line from the dot to the x-axis */}
            <div aria-hidden style={{
              position: 'absolute', left: `${hover.xPct}%`, width: 1,
              top: `${hover.yPct}%`, bottom: 0,
              background: 'rgba(237,230,230,0.35)', transform: 'translateX(-0.5px)',
              pointerEvents: 'none',
            }} />
            {/* Hollow dot on the line */}
            <div aria-hidden style={{
              position: 'absolute', left: `${hover.xPct}%`, top: `${hover.yPct}%`,
              width: 9, height: 9, borderRadius: '50%',
              background: BG_DARK_CARD, border: `2px solid ${brandVar}`,
              transform: 'translate(-50%, -50%)', pointerEvents: 'none',
            }} />
            {/* Value + date readout */}
            <div data-testid="recovered-readout" style={{
              position: 'absolute', top: -6,
              left: `${Math.min(80, Math.max(20, hover.xPct))}%`,
              transform: 'translateX(-50%)',
              background: 'rgba(255,255,255,0.1)', borderRadius: 8,
              padding: '3px 8px', fontSize: 10, fontFamily: FONT_BODY,
              whiteSpace: 'nowrap', pointerEvents: 'none', color: LIGHT,
            }}>
              <span style={{ fontWeight: 700 }}>{moneyShort(hover.point.cents)}</span>
              <span style={{ color: LIGHT_DIM }}> · {shortDate(hover.point.date)}</span>
            </div>
          </>
        )}
      </div>

      {/* Hairline + sparse date labels */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        borderTop: `1px solid ${HAIRLINE}`, marginTop: 2, paddingTop: 5,
      }}>
        {ticks.map(i => (
          <span key={i} style={{ fontSize: 9, fontFamily: FONT_BODY, color: 'rgba(237,230,230,0.45)' }}>
            {shortDate(points[i].date)}
          </span>
        ))}
      </div>
    </div>
  );
}
