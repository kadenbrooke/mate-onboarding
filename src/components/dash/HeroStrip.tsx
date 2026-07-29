'use client';
import { useId } from 'react';
import { Clock, Lightning, ArrowUpRight, ArrowDownRight } from '@phosphor-icons/react';
import type { HeroSeries } from '@/lib/metrics/hero';
import type { DailyPoint } from '@/lib/metrics/recovered';
import { RecoveredCard } from './RecoveredCard';
import { useCountUp } from './useCountUp';
import { useCardTheme, CardModeStar, themeKeyFromLabel } from './cardTheme';
import {
  NUM_DISPLAY, FONT_BODY, brandVar,
  CARD_BG, CARD_FG, CARD_MUTED, CARD_SHADOW,
  SCORE_GREEN, SCORE_RED,
} from '@/lib/theme';

/** Orange area sparkline: weekly buckets, gradient fill fading downward. */
function AreaSpark({ buckets, testId }: { buckets: number[]; testId: string }) {
  const rawId = useId();
  const gradId = `spark-${rawId.replace(/:/g, '')}`;
  const W = 200;
  const H = 40;
  const max = Math.max(...buckets, 1);
  const pts = buckets.map((v, i) => {
    const x = buckets.length === 1 ? W / 2 : (i / (buckets.length - 1)) * W;
    const y = H - 3 - (v / max) * (H - 8);
    return { x, y };
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  return (
    <svg data-testid={testId} viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
      preserveAspectRatio="none" style={{ display: 'block', marginTop: 10 }} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={brandVar} stopOpacity={0.35} />
          <stop offset="100%" stopColor={brandVar} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={brandVar} strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TrendBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  const color = up ? SCORE_GREEN : SCORE_RED;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
      color, background: `color-mix(in srgb, ${color} 10%, transparent)`,
      borderRadius: 99, padding: '3px 8px',
    }}>
      <Arrow size={11} weight="bold" aria-hidden />
      {up ? '+' : ''}{pct}%
    </span>
  );
}

type HeroCardProps = {
  icon: React.ReactNode;
  label: string;
  trendPct: number;
  big: React.ReactNode;
  sub?: string;
  buckets: number[];
  sparkTestId: string;
};

function HeroCard({ icon, label, trendPct, big, sub, buckets, sparkTestId }: HeroCardProps) {
  const { dark, vars, toggle } = useCardTheme(themeKeyFromLabel(label));
  return (
    <div className="hero-card" data-card-mode={dark ? 'dark' : 'light'} style={{
      flex: 1, minWidth: 0, borderRadius: 16, padding: 16,
      background: CARD_BG, color: CARD_FG, boxShadow: CARD_SHADOW,
      display: 'flex', flexDirection: 'column', ...vars,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <CardModeStar dark={dark} onToggle={toggle} />
          <span aria-hidden style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in srgb, ${brandVar} 12%, transparent)`,
            color: brandVar,
          }}>
            {icon}
          </span>
          <span style={{
            fontSize: 11, letterSpacing: 1.5, fontWeight: 600, fontFamily: FONT_BODY,
            color: CARD_MUTED,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {label}
          </span>
        </div>
        <TrendBadge pct={trendPct} />
      </div>
      <div style={{ fontSize: 28, marginTop: 12, whiteSpace: 'nowrap', ...NUM_DISPLAY }}>{big}</div>
      {sub && (
        <div style={{ fontSize: 11, fontFamily: FONT_BODY, marginTop: 2, color: CARD_MUTED }}>
          {sub}
        </div>
      )}
      <div style={{ marginTop: 'auto' }}>
        <AreaSpark buckets={buckets} testId={sparkTestId} />
      </div>
    </div>
  );
}

export type HeroStripSeries = { recovered: HeroSeries; hours: HeroSeries; actions: HeroSeries };

export function HeroStrip({ recoveredCents, roiMultiple, hoursSaved, actions, series, recovered }: {
  recoveredCents: number; roiMultiple: number; hoursSaved: number; actions: number;
  series: HeroStripSeries;
  recovered: { points: DailyPoint[]; deltaCents: number };
}) {
  const hrs = useCountUp(hoursSaved, 1200);
  const act = useCountUp(actions, 1200);
  return (
    <div className="hero-strip" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {/* Mobile: the dark Recovered card would pin its 260px min-width while
          the two white stat cards (min-width 0) got crushed to ~45px each.
          Below 641px the dark card takes the full first row and the stat
          cards split the second row 2-up. */}
      <style>{`
        @media (max-width: 640px) {
          .hero-strip .hero-dark { flex: 1 1 100% !important; min-width: 100% !important; }
          .hero-strip .hero-card { flex: 1 1 40% !important; min-width: 130px !important; }
        }
      `}</style>
      {/* Recovered $: the page's ONE dark accent card, Mercury-style chart */}
      <RecoveredCard
        totalCents={recoveredCents}
        roiMultiple={roiMultiple}
        deltaCents={recovered.deltaCents}
        points={recovered.points}
      />
      <HeroCard
        icon={<Clock size={16} weight="bold" />}
        label="HOURS SAVED"
        trendPct={series.hours.trendPct}
        big={`${Math.round(hrs)}h`}
        sub="handled while you worked"
        buckets={series.hours.buckets}
        sparkTestId="hero-spark-hours"
      />
      <HeroCard
        icon={<Lightning size={16} weight="bold" />}
        label="ACTIONS"
        trendPct={series.actions.trendPct}
        big={Math.round(act)}
        sub="taken by your agents this week"
        buckets={series.actions.buckets}
        sparkTestId="hero-spark-actions"
      />
    </div>
  );
}
