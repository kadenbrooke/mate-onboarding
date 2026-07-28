'use client';
import { useState } from 'react';
import { pipelineTotals, type Lead } from '@/lib/metrics/leads';
import { ringSegments } from '@/lib/metrics/ring';
import { Card } from '../Card';
import { FREE_GREEN, LOST_BROWN } from '@/lib/theme';

type Seg = 'won' | 'lost' | 'open';

const SEG_COLOR: Record<Seg, string> = {
  won: FREE_GREEN,
  lost: LOST_BROWN,
  open: 'var(--brand-primary, #e14d1a)',
};

const SEG_LABEL: Record<Seg, string> = {
  won: 'WON',
  lost: 'LOST',
  open: 'ON THE TABLE',
};

const money = (cents: number) => `$${(cents / 100000).toFixed(1)}k`;

export function TwinRings({ leads }: { leads: Lead[] }) {
  const t = pipelineTotals(leads);
  const quotedTotal = t.wonCents + t.lostCents + t.openCents;
  const avgJob = t.counts.won ? Math.round(t.wonCents / t.counts.won) : 0;

  return (
    <Card label="THE PIPELINE">
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 8 }}>
        <Ring
          idPrefix="rev"
          values={{ won: t.wonCents, lost: t.lostCents, open: t.openCents }}
          format={money}
          sub={(seg) => seg === 'won' ? `of ${money(quotedTotal)} quoted` : SEG_LABEL[seg]}
          caption="REVENUE"
        />
        <Ring
          idPrefix="lead"
          values={{ won: t.counts.won, lost: t.counts.lost, open: t.counts.open }}
          format={(v) => String(v)}
          sub={(seg) => seg === 'won' ? `${t.winRate}% win rate` : SEG_LABEL[seg]}
          caption="LEADS"
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18, fontSize: 10, marginTop: 8 }}>
        {(['won', 'lost', 'open'] as Seg[]).map(s => (
          <span key={s}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: 2,
              background: SEG_COLOR[s], marginRight: 5,
            }} />
            {SEG_LABEL[s]}
          </span>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {avgJob ? money(avgJob) : '$0'}
        </span>
        <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 6 }}>AVG JOB</span>
      </div>
    </Card>
  );
}

function Ring({ idPrefix, values, format, sub, caption }: {
  idPrefix: string;
  values: Record<Seg, number>;
  format: (v: number) => string;
  sub: (seg: Seg) => string;
  caption: string;
}) {
  const [active, setActive] = useState<Seg>('won');

  const segs = ringSegments(
    (['won', 'lost', 'open'] as Seg[]).map(k => ({ key: k, value: values[k] })),
    48,
    3,
  );

  const C = 2 * Math.PI * 48;

  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 120 120" style={{ width: 140 }}>
        <g transform="translate(60,60) rotate(-90)">
          <circle r={48} fill="none" stroke="#222" strokeWidth={11} />
          {segs.map(s => (
            <circle
              key={s.key}
              data-testid={`${idPrefix}-seg-${s.key}`}
              r={48}
              fill="none"
              stroke={SEG_COLOR[s.key as Seg]}
              strokeWidth={active === s.key ? 13 : 11}
              strokeLinecap="round"
              strokeDasharray={`${s.dash} ${C}`}
              strokeDashoffset={s.offset}
              style={{
                cursor: 'pointer',
                filter: active === s.key
                  ? `drop-shadow(0 0 6px ${SEG_COLOR[s.key as Seg]})`
                  : undefined,
              }}
              onClick={() => setActive(s.key as Seg)}
              onMouseEnter={() => setActive(s.key as Seg)}
            />
          ))}
        </g>
        <text
          data-testid={`${idPrefix}-center`}
          x="60"
          y="56"
          textAnchor="middle"
          fill={SEG_COLOR[active]}
          fontSize="15"
          fontWeight="800"
        >
          {format(values[active])}
        </text>
        <text x="60" y="70" textAnchor="middle" fill="#8a8a8a" fontSize="7">
          {sub(active)}
        </text>
      </svg>
      <div style={{ fontSize: 10, letterSpacing: 1.5, opacity: 0.55, marginTop: 2 }}>
        {caption}
      </div>
    </div>
  );
}
