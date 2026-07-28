'use client';
import { useState } from 'react';
import { ringSegments } from '@/lib/metrics/ring';
import { moneyShort } from '@/lib/metrics/format';
import { FREE_GREEN, LOST_BROWN, brandVar, NUM_DISPLAY, NUM_TABLE, FONT_BODY, FONT_HEAD, FONT_NUM } from '@/lib/theme';
import type { Reputation } from '@/components/dash/types';

type RingKey = 'won' | 'lost' | 'open';

const SEG_COLOR: Record<RingKey, string> = {
  won: FREE_GREEN,
  lost: LOST_BROWN,
  open: brandVar,
};

export function ReferralRing({ reputation }: { reputation: Reputation }) {
  const { referrals_closed, referrals_lost, referrals_in, referral_revenue_cents } = reputation;
  const open = Math.max(0, referrals_in - referrals_closed - referrals_lost);

  const [active, setActive] = useState<RingKey>('won');

  const segs = ringSegments(
    [
      { key: 'won', value: referrals_closed },
      { key: 'lost', value: referrals_lost },
      { key: 'open', value: open },
    ],
    48,
    3,
  );

  const C = 2 * Math.PI * 48;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {/* Donut ring */}
      <div style={{ flexShrink: 0 }}>
        <svg viewBox="0 0 120 120" style={{ width: 110 }}>
          <g transform="translate(60,60) rotate(-90)">
            <circle r={48} fill="none" stroke="#222" strokeWidth={11} />
            {segs.map((s) => (
              <circle
                key={s.key}
                r={48}
                fill="none"
                stroke={SEG_COLOR[s.key as RingKey]}
                strokeWidth={active === s.key ? 13 : 11}
                strokeLinecap="round"
                strokeDasharray={`${s.dash} ${C}`}
                strokeDashoffset={s.offset}
                style={{
                  cursor: 'pointer',
                  filter: active === s.key
                    ? `drop-shadow(0 0 6px ${SEG_COLOR[s.key as RingKey]})`
                    : undefined,
                }}
                onClick={() => setActive(s.key as RingKey)}
                onMouseEnter={() => setActive(s.key as RingKey)}
              />
            ))}
          </g>
          {/* Center display */}
          <text
            x="60" y="54"
            textAnchor="middle"
            fill={SEG_COLOR[active]}
            fontSize="14"
            fontWeight="300"
            fontFamily={FONT_NUM}
          >
            {active === 'won' ? referrals_closed : active === 'lost' ? referrals_lost : open}
          </text>
          <text x="60" y="67" textAnchor="middle" fill="#8a8a8a" fontSize="7" fontFamily={FONT_BODY}>
            {active === 'won' ? 'WON' : active === 'lost' ? 'LOST' : 'OPEN'}
          </text>
        </svg>
      </div>

      {/* Right side stats */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: FREE_GREEN, fontFamily: FONT_HEAD, marginBottom: 4 }}>
          REFERRAL WINS
        </div>
        <div style={{
          fontSize: 24,
          ...NUM_DISPLAY,
          color: FREE_GREEN,
          textShadow: `0 0 12px ${FREE_GREEN}88`,
          lineHeight: 1.1,
        }}>
          {moneyShort(referral_revenue_cents)}
        </div>
        <div style={{ fontSize: 10, opacity: 0.7, fontFamily: FONT_BODY, marginTop: 4 }}>
          captured · $0 to acquire
        </div>
        <div style={{ fontSize: 9, opacity: 0.6, fontFamily: FONT_BODY, marginTop: 6, ...NUM_TABLE }}>
          {referrals_closed} won / {referrals_lost} lost / {open} open
        </div>
      </div>
    </div>
  );
}
