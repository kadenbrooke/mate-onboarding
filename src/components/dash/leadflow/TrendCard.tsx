'use client';
import { useState, useEffect, useId } from 'react';
import { Card } from '../Card';
import { weekBars, monthBuckets, yearBuckets } from '@/lib/metrics/leads';
import { brandVar, TRACK_BEIGE, TEXT_MUTED, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

type Range = 'WEEK' | 'MONTH' | 'YEAR';

const BAR_AREA_H = 56; // px height of the bar plotting area

function Sparkline({ counts }: { counts: number[] }) {
  const rawId = useId();
  const gradId = `trend-grad-${rawId.replace(/:/g, '')}`;
  const max = Math.max(...counts, 1);
  const W = 220;
  const H = 52;
  const pts = counts.map((c, i) => {
    const x = counts.length === 1 ? W / 2 : (i / (counts.length - 1)) * W;
    const y = H - 2 - (c / max) * (H - 6);
    return { x, y };
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  return (
    <svg
      data-testid="trend-spark"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      style={{ display: 'block', marginTop: 12 }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={brandVar} stopOpacity={0.3} />
          <stop offset="100%" stopColor={brandVar} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={brandVar}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
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
          className="dash-tap"
          onClick={() => setRange(c)}
          style={{
            fontSize: 10,
            letterSpacing: 1,
            padding: '5px 10px',
            borderRadius: 99,
            border: 'none',
            cursor: 'pointer',
            background: range === c ? brandVar : TRACK_BEIGE,
            color: range === c ? '#fff' : TEXT_MUTED,
            fontWeight: range === c ? 700 : 400,
            fontFamily: FONT_BODY,
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
      // Bar heights are computed in px against BAR_AREA_H. The previous
      // percentage-height version resolved against an auto-height flex column
      // (undefined % base), which collapsed every bar to its 2px minHeight:
      // the "week view renders no bars" bug.
      return (
        <div
          data-testid="trend-bars"
          style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: BAR_AREA_H + 16, marginTop: 12 }}
        >
          {bars.map(({ day, count }) => {
            const h = count > 0 ? Math.max(6, (count / max) * BAR_AREA_H) : 6;
            return (
              <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                <div
                  data-testid={`trend-bar-${day}`}
                  data-count={count}
                  style={{
                    width: '100%',
                    height: h,
                    background: count > 0 ? brandVar : TRACK_BEIGE,
                    borderRadius: count > 0 ? '5px 5px 2px 2px' : 3,
                  }}
                />
                <span style={{ fontSize: 9, color: TEXT_MUTED, fontFamily: FONT_BODY }}>{day}</span>
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
      {/* Standalone display stat: Geist 300 pnum per brand guide */}
      <div style={{ fontSize: 28, marginTop: 6, ...NUM_DISPLAY }}>{weekCount}</div>
      {chartBody}
    </Card>
  );
}
