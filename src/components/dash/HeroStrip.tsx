'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { CurrencyDollar, Clock, Lightning, ArrowUpRight, ArrowDownRight } from '@phosphor-icons/react';
import { moneyShort } from '@/lib/metrics/format';
import type { HeroSeries } from '@/lib/metrics/hero';
import {
  NUM_DISPLAY, FONT_BODY, brandVar,
  BG_CARD, BG_DARK_CARD, CARD_SHADOW, TEXT_DARK, TEXT_MUTED,
  SCORE_GREEN, SCORE_RED,
} from '@/lib/theme';

function useCountUp(target: number, ms = 1500) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3))); // cubic ease-out
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return value;
}

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

function TrendBadge({ pct, dark }: { pct: number; dark?: boolean }) {
  const up = pct >= 0;
  const color = up ? SCORE_GREEN : SCORE_RED;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
      color, background: dark ? 'rgba(255,255,255,0.08)' : `color-mix(in srgb, ${color} 10%, transparent)`,
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
  dark?: boolean;
};

function HeroCard({ icon, label, trendPct, big, sub, buckets, sparkTestId, dark }: HeroCardProps) {
  return (
    <div style={{
      flex: 1, minWidth: 0, borderRadius: 16, padding: 16,
      background: dark ? BG_DARK_CARD : BG_CARD,
      color: dark ? '#ede6e6' : TEXT_DARK,
      boxShadow: CARD_SHADOW,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span aria-hidden style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: dark ? 'rgba(255,255,255,0.1)' : `color-mix(in srgb, ${brandVar} 12%, transparent)`,
            color: brandVar,
          }}>
            {icon}
          </span>
          <span style={{
            fontSize: 11, letterSpacing: 1.5, fontWeight: 600, fontFamily: FONT_BODY,
            color: dark ? 'rgba(237,230,230,0.65)' : TEXT_MUTED,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {label}
          </span>
        </div>
        <TrendBadge pct={trendPct} dark={dark} />
      </div>
      <div style={{ fontSize: 28, marginTop: 12, ...NUM_DISPLAY }}>{big}</div>
      {sub && (
        <div style={{
          fontSize: 11, fontFamily: FONT_BODY, marginTop: 2,
          color: dark ? 'rgba(237,230,230,0.6)' : TEXT_MUTED,
        }}>
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

export function HeroStrip({ recoveredCents, roiMultiple, hoursSaved, actions, series }: {
  recoveredCents: number; roiMultiple: number; hoursSaved: number; actions: number;
  series: HeroStripSeries;
}) {
  const rec = useCountUp(recoveredCents);
  const hrs = useCountUp(hoursSaved, 1200);
  const act = useCountUp(actions, 1200);
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {/* Recovered $: the page's ONE dark accent card */}
      <HeroCard
        dark
        icon={<CurrencyDollar size={16} weight="bold" />}
        label="RECOVERED"
        trendPct={series.recovered.trendPct}
        big={moneyShort(rec)}
        sub={`${roiMultiple.toFixed(1)}x what you pay`}
        buckets={series.recovered.buckets}
        sparkTestId="hero-spark-recovered"
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
