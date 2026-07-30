'use client';
import { useState } from 'react';
import { Card } from '../Card';
import { ringSegments } from '@/lib/metrics/ring';
import { moneyShort } from '@/lib/metrics/format';
import type { AdTotals } from '@/lib/metrics/ads';
import {
  brandVar, FREE_GREEN, CARD_TRACK, CARD_MUTED, CARD_HAIRLINE, CARD_INSET,
  NUM_DISPLAY, FONT_BODY, FONT_HEAD, FONT_NUM,
} from '@/lib/theme';

// Ad Performance zone -- Meta ad spend + cost-per-lead for the client.
// Headline metric is COST PER LEAD (what J&C actually cares about: what each
// lead costs them). A center-swap ring (the locked Mate ring standard) shows
// per-campaign spend; tapping the center cycles SPEND / LEADS / CPL.

type Center = 'cpl' | 'spend' | 'leads';

// Multi-campaign ring palette: brand orange leads, then a warm supporting
// ramp. Single-campaign (J&C today) just uses orange.
const SPEND_RAMP = ['var(--brand-primary, #e14d1a)', '#c98a4a', '#8a6a50', '#a3603f', '#6f5340'];

const CENTER_LABEL: Record<Center, string> = {
  cpl: 'PER LEAD',
  spend: 'AD SPEND',
  leads: 'LEADS',
};

export function AdPerformanceZone({ ads, showLabel = true }: {
  ads: AdTotals | null;
  showLabel?: boolean;
}) {
  const label = showLabel ? 'AD PERFORMANCE' : undefined;
  const [center, setCenter] = useState<Center>('cpl');

  if (ads == null || ads.campaigns.length === 0) {
    return (
      <Card label={label} themeKey="ad-performance">
        <div style={{ color: CARD_MUTED, fontSize: 12, marginTop: 10, fontFamily: FONT_BODY }}>
          turns on with your first ad pull
        </div>
      </Card>
    );
  }

  const radius = 48;
  const C = 2 * Math.PI * radius;
  // Ring proportion = share of spend per campaign (where the money goes).
  const segs = ringSegments(
    ads.campaigns.map((c) => ({ key: c.campaign_id, value: c.spend_cents })),
    radius,
    ads.campaigns.length > 1 ? 3 : 0,
  );

  const centerValue =
    center === 'cpl' ? moneyShort(ads.cpl_cents)
    : center === 'spend' ? moneyShort(ads.spend_cents)
    : String(ads.leads);
  const centerColor = center === 'leads' ? FREE_GREEN : brandVar;

  return (
    <Card label={label} themeKey="ad-performance">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10 }}>
        {/* Center-swap ring: segments = per-campaign spend share */}
        <svg viewBox="0 0 120 120" style={{ width: 128, flexShrink: 0 }} aria-hidden>
          <g transform="translate(60,60) rotate(-90)">
            <circle r={radius} fill="none" stroke={CARD_TRACK} strokeWidth={11} />
            {segs.map((s, i) => (
              <circle
                key={s.key}
                data-testid={`ad-seg-${s.key}`}
                r={radius}
                fill="none"
                stroke={SPEND_RAMP[i % SPEND_RAMP.length]}
                strokeWidth={11}
                strokeLinecap={ads.campaigns.length > 1 ? 'round' : 'butt'}
                strokeDasharray={`${s.dash} ${C}`}
                strokeDashoffset={s.offset}
              />
            ))}
          </g>
          <text
            data-testid="ad-center-value"
            x="60" y="57" textAnchor="middle"
            fill={centerColor} fontSize="19" fontWeight="300" fontFamily={FONT_NUM}
          >
            {centerValue}
          </text>
          <text x="60" y="72" textAnchor="middle" fill={CARD_MUTED} fontSize="7.5" fontFamily={FONT_BODY}>
            {CENTER_LABEL[center]}
          </text>
        </svg>

        {/* Swap chips: tap to change what the ring center shows. CPL first --
            it is the headline the ring is built to sell. */}
        <div style={{ flex: 1, display: 'grid', gap: 6 }}>
          {(['cpl', 'spend', 'leads'] as Center[]).map((k) => {
            const active = center === k;
            const val =
              k === 'cpl' ? moneyShort(ads.cpl_cents)
              : k === 'spend' ? moneyShort(ads.spend_cents)
              : String(ads.leads);
            const accent = k === 'leads' ? FREE_GREEN : brandVar;
            return (
              <button
                key={k}
                type="button"
                data-testid={`ad-chip-${k}`}
                onClick={() => setCenter(k)}
                onMouseEnter={() => setCenter(k)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  gap: 10, padding: '7px 10px', borderRadius: 10, cursor: 'pointer',
                  textAlign: 'left', width: '100%',
                  border: `1px solid ${active ? accent : CARD_HAIRLINE}`,
                  background: active ? `color-mix(in srgb, ${accent} 8%, transparent)` : 'transparent',
                }}
              >
                <span style={{ fontSize: 10, letterSpacing: 1.2, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>
                  {CENTER_LABEL[k]}
                </span>
                <span style={{ fontSize: 15, ...NUM_DISPLAY, color: accent }}>{val}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-campaign breakdown */}
      <div style={{ marginTop: 14 }}>
        <div style={{
          fontSize: 10, letterSpacing: 1.5, color: CARD_MUTED,
          fontFamily: FONT_HEAD, fontFeatureSettings: '"ss04"', marginBottom: 8,
        }}>
          BY CAMPAIGN
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {ads.campaigns.map((c, i) => (
            <div
              key={c.campaign_id}
              data-testid={`ad-campaign-${c.campaign_id}`}
              style={{
                display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 10, alignItems: 'center',
                padding: '9px 11px', borderRadius: 10, background: CARD_INSET,
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: 2,
                background: SPEND_RAMP[i % SPEND_RAMP.length],
              }} />
              <span style={{
                fontSize: 12, fontFamily: FONT_BODY, color: 'var(--card-fg, #141414)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.campaign_name}
              </span>
              <span style={{ display: 'flex', gap: 12, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                <Stat value={moneyShort(c.spend_cents)} unit="spent" />
                <Stat value={String(c.leads)} unit="leads" color={FREE_GREEN} />
                <Stat value={moneyShort(c.cpl_cents)} unit="/lead" color={brandVar} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {ads.date_pulled && (
        <div style={{ marginTop: 10, fontSize: 9.5, letterSpacing: 0.5, color: CARD_MUTED, fontFamily: FONT_BODY }}>
          Last 30 days &middot; updated {ads.date_pulled}
        </div>
      )}
    </Card>
  );
}

function Stat({ value, unit, color }: { value: string; unit: string; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'baseline' }}>
      <span style={{ fontSize: 13, ...NUM_DISPLAY, color: color ?? 'var(--card-fg, #141414)' }}>{value}</span>
      <span style={{ fontSize: 9, color: CARD_MUTED, fontFamily: FONT_BODY }}>{unit}</span>
    </span>
  );
}
