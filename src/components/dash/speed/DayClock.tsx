'use client';
import { useState } from 'react';
import { Card } from '../Card';
import { ringSegments } from '@/lib/metrics/ring';
import { FREE_GREEN, brandVar, CARD_TRACK, CARD_MUTED, FONT_BODY, FONT_NUM } from '@/lib/theme';

// Two-segment ring: leads caught OUTSIDE work hours (the success metric,
// green) vs during work hours (brand). The split reuses the existing
// after_hours lead flag computed upstream (speedStats).
//
// Mate ring standard (locked): default center = after-hours count; hover/tap
// a segment to swap that segment's stat into the center, color-matched and
// sticky until another segment is picked.

type SegKey = 'after' | 'during';

const SEG_COLOR: Record<SegKey, string> = { after: FREE_GREEN, during: brandVar };
const SEG_LABEL: Record<SegKey, string> = { after: 'AFTER HOURS', during: 'WORK HOURS' };
const SEG_SUB: Record<SegKey, string> = {
  after: 'caught nights + weekends',
  during: 'came in during the workday',
};

export function DayClock({ totalCount, afterHoursCount }: { totalCount: number; afterHoursCount: number }) {
  const [active, setActive] = useState<SegKey>('after');
  const during = Math.max(0, totalCount - afterHoursCount);
  const values: Record<SegKey, number> = { after: afterHoursCount, during };

  const R = 48;
  const C = 2 * Math.PI * R;
  const segs = ringSegments(
    [{ key: 'after', value: afterHoursCount }, { key: 'during', value: during }],
    R,
    3,
  );

  return (
    <Card label="WHEN LEADS ARRIVE">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
        <svg viewBox="0 0 120 120" style={{ width: 116, flexShrink: 0 }} data-testid="dayclock-ring">
          <g transform="translate(60,60) rotate(-90)">
            <circle r={R} fill="none" stroke={CARD_TRACK} strokeWidth={11} />
            {segs.map(s => (
              <circle
                key={s.key}
                data-testid={`dayclock-seg-${s.key}`}
                r={R}
                fill="none"
                stroke={SEG_COLOR[s.key as SegKey]}
                strokeWidth={active === s.key ? 13 : 11}
                strokeLinecap="round"
                strokeDasharray={`${s.dash} ${C}`}
                strokeDashoffset={s.offset}
                style={{ cursor: 'pointer' }}
                onClick={() => setActive(s.key as SegKey)}
                onMouseEnter={() => setActive(s.key as SegKey)}
              />
            ))}
          </g>
          {/* Center swap: active segment's stat, color-matched */}
          <text
            data-testid="dayclock-center"
            x="60" y="56"
            textAnchor="middle"
            fill={SEG_COLOR[active]}
            fontSize="22"
            fontWeight="300"
            fontFamily={FONT_NUM}
          >
            {values[active]}
          </text>
          <text x="60" y="71" textAnchor="middle" fill={CARD_MUTED} fontSize="7" letterSpacing={1} fontFamily={FONT_BODY}>
            {SEG_LABEL[active]}
          </text>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['after', 'during'] as SegKey[]).map(k => (
            <button
              key={k}
              type="button"
              className="dash-tap"
              onClick={() => setActive(k)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                fontFamily: FONT_BODY, background: 'none', border: 'none', padding: '4px 0',
                cursor: 'pointer', textAlign: 'left',
                color: active === k ? SEG_COLOR[k] : CARD_MUTED,
                fontWeight: active === k ? 700 : 400,
              }}
            >
              <span aria-hidden style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: SEG_COLOR[k], flexShrink: 0,
              }} />
              {SEG_LABEL[k].toLowerCase()} {values[k]}
            </button>
          ))}
          <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: CARD_MUTED }}>
            {SEG_SUB[active]}
          </div>
        </div>
      </div>
    </Card>
  );
}
