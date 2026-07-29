'use client';
import { useId, useState } from 'react';
import { CurrencyDollar, ArrowUpRight, ArrowDownRight } from '@phosphor-icons/react';
import { moneyShort } from '@/lib/metrics/format';
import {
  splitDollarsCents, sparseTickIndexes, scaleSeries, monotonePath, areaPath,
  nearestIndexForFraction, type DailyPoint,
} from '@/lib/metrics/recovered';
import { useCountUp } from './useCountUp';
import { useCardTheme, CardModeStar } from './cardTheme';
import {
  NUM_DISPLAY, FONT_BODY, brandVar, CARD_SHADOW,
  CARD_BG, CARD_FG, CARD_MUTED, CARD_FAINT, CARD_HAIRLINE, CARD_CHIP,
  SCORE_GREEN, SCORE_RED,
} from '@/lib/theme';

// Mercury-style interactive area chart. Defaults to the page's dark accent
// treatment; the star toggle (round-4) flips it to the light card treatment.
// All surface-dependent colors come from the --card-* vars so the chart,
// gradient, crosshair, and readout adapt to either mode.

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
  const { dark, vars, toggle } = useCardTheme('recovered', true);

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
    <div className="hero-dark" data-card-mode={dark ? 'dark' : 'light'} style={{
      flex: 1.6, minWidth: 260, borderRadius: 16, padding: 16,
      background: CARD_BG, color: CARD_FG, boxShadow: CARD_SHADOW,
      display: 'flex', flexDirection: 'column', ...vars,
    }}>
      {/* Header: star toggle + icon chip + label, WoW dollar delta right-aligned */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <CardModeStar dark={dark} onToggle={toggle} />
          <span aria-hidden style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: CARD_CHIP, color: brandVar,
          }}>
            <CurrencyDollar size={16} weight="bold" />
          </span>
          <span style={{
            fontSize: 11, letterSpacing: 1.5, fontWeight: 600, fontFamily: FONT_BODY,
            color: CARD_MUTED, whiteSpace: 'nowrap',
          }}>
            RECOVERED
          </span>
        </div>
        <span data-testid="recovered-delta" style={{
          display: 'inline-flex', alignItems: 'center', gap: 2,
          fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
          color: up ? SCORE_GREEN : SCORE_RED,
          background: CARD_CHIP, borderRadius: 99, padding: '3px 8px',
        }}>
          <DeltaArrow size={11} weight="bold" aria-hidden />
          {moneyShort(Math.abs(deltaCents))}
        </span>
      </div>

      {/* Big number: cents rendered superscript, Mercury style. nowrap keeps
          the cents glued to the dollars at narrow widths. */}
      <div style={{ marginTop: 10, lineHeight: 1, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 32, ...NUM_DISPLAY }}>${dollars}</span>
        <span style={{
          fontSize: 16, ...NUM_DISPLAY,
          verticalAlign: 'super', marginLeft: 1, color: CARD_MUTED,
        }}>
          .{cents}
        </span>
      </div>
      <div style={{ fontSize: 11, fontFamily: FONT_BODY, marginTop: 5, color: CARD_MUTED }}>
        {points.length > 0 ? longDate(points[points.length - 1].date) : ''}
        {roiMultiple > 0 ? ` · ${roiMultiple.toFixed(1)}x what you pay` : ''}
      </div>

      {/* Chart + crosshair overlay */}
      <div
        data-testid="recovered-chart"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHoverIdx(null)}
        style={{ position: 'relative', marginTop: 'auto', height: 96, touchAction: 'pan-y' }}
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
              background: CARD_FAINT, transform: 'translateX(-0.5px)',
              pointerEvents: 'none',
            }} />
            {/* Hollow dot on the line */}
            <div aria-hidden style={{
              position: 'absolute', left: `${hover.xPct}%`, top: `${hover.yPct}%`,
              width: 9, height: 9, borderRadius: '50%',
              background: CARD_BG, border: `2px solid ${brandVar}`,
              transform: 'translate(-50%, -50%)', pointerEvents: 'none',
            }} />
            {/* Value + date readout */}
            <div data-testid="recovered-readout" style={{
              position: 'absolute', top: -6,
              left: `${Math.min(80, Math.max(20, hover.xPct))}%`,
              transform: 'translateX(-50%)',
              background: CARD_CHIP, borderRadius: 8,
              padding: '3px 8px', fontSize: 10, fontFamily: FONT_BODY,
              whiteSpace: 'nowrap', pointerEvents: 'none', color: CARD_FG,
            }}>
              <span style={{ fontWeight: 700 }}>{moneyShort(hover.point.cents)}</span>
              <span style={{ color: CARD_MUTED }}> · {shortDate(hover.point.date)}</span>
            </div>
          </>
        )}
      </div>

      {/* Hairline + sparse date labels */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        borderTop: `1px solid ${CARD_HAIRLINE}`, marginTop: 2, paddingTop: 5,
      }}>
        {ticks.map(i => (
          <span key={i} style={{ fontSize: 9, fontFamily: FONT_BODY, color: CARD_FAINT }}>
            {shortDate(points[i].date)}
          </span>
        ))}
      </div>
    </div>
  );
}
