'use client';
import { useState, useEffect, useId } from 'react';
import { Card } from '../Card';
import { weekBars, monthBuckets, yearBuckets } from '@/lib/metrics/leads';
import { brandVar } from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

type Range = 'WEEK' | 'MONTH' | 'YEAR';

function Sparkline({ counts }: { counts: number[] }) {
  const rawId = useId();
  const glowId = rawId.replace(/:/g, '');
  const max = Math.max(...counts, 1);
  const W = 220;
  const H = 52;
  const pts = counts.map((c, i) => {
    const x = counts.length === 1 ? W / 2 : (i / (counts.length - 1)) * W;
    const y = H - (c / max) * (H - 4);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg
      data-testid="trend-spark"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ display: 'block', marginTop: 12 }}
    >
      <defs>
        <filter id={glowId}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <polyline
        points={pts}
        fill="none"
        stroke={brandVar}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        filter={`url(#${glowId})`}
      />
    </svg>
  );
}

export function TrendCard({ leads }: { leads: Lead[] }) {
  const [range, setRange] = useState<Range>('WEEK');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const weekCount = leads.filter(l => {
    const d = new Date(l.created_at);
    const diffMs = new Date().getTime() - d.getTime();
    return diffMs >= 0 && diffMs < 7 * 86400000;
  }).length;

  const chips: Range[] = ['WEEK', 'MONTH', 'YEAR'];
  const right = (
    <div style={{ display: 'flex', gap: 4 }}>
      {chips.map(c => (
        <button
          key={c}
          aria-label={c}
          onClick={() => setRange(c)}
          style={{
            fontSize: 9,
            letterSpacing: 1,
            padding: '2px 7px',
            borderRadius: 99,
            border: 'none',
            cursor: 'pointer',
            background: range === c ? brandVar : '#2a2a2a',
            color: range === c ? '#fff' : 'rgba(255,255,255,0.55)',
            fontFamily: 'inherit',
          }}
        >
          {c}
        </button>
      ))}
    </div>
  );

  const chartBody = (() => {
    if (!mounted) {
      // Fixed-height placeholder: SSR never disagrees with client (68 = 56px bars + 12px marginTop)
      return <div style={{ height: 68 }} />;
    }
    if (range === 'WEEK') {
      const bars = weekBars(leads);
      const max = Math.max(...bars.map(b => b.count), 1);
      return (
        <div
          data-testid="trend-bars"
          style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 56, marginTop: 12 }}
        >
          {bars.map(({ day, count }) => {
            const pct = Math.max((count / max) * 100, 2);
            return (
              <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div
                  style={{
                    width: '100%',
                    height: `${pct}%`,
                    minHeight: 2,
                    background: `linear-gradient(to bottom, ${brandVar}, transparent)`,
                    borderRadius: '3px 3px 0 0',
                  }}
                />
                <span style={{ fontSize: 9, opacity: 0.4 }}>{day}</span>
              </div>
            );
          })}
        </div>
      );
    }
    if (range === 'MONTH') return <Sparkline counts={monthBuckets(leads)} />;
    return <Sparkline counts={yearBuckets(leads)} />;
  })();

  return (
    <Card label="LEADS" right={right}>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: '#fff' }}>{weekCount}</div>
      {chartBody}
    </Card>
  );
}
