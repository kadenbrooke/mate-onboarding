import { Card } from '../Card';
import { valueWheel, pipelineTotals } from '@/lib/metrics/leads';
import { wheelWedges } from '@/lib/metrics/wheel';
import type { Lead } from '@/lib/metrics/leads';
import { BRAND_RAMP } from '@/lib/metrics/colors';
import { moneyShort } from '@/lib/metrics/format';
import { CARD_MUTED, FONT_NUM, FONT_BODY, CARD_BG, CARD_FG } from '@/lib/theme';

const WEDGE_COLORS = BRAND_RAMP;

export function ValueWheel({ leads }: { leads: Lead[] }) {
  const stats = valueWheel(leads).slice(0, 5);
  const wedges = wheelWedges(stats, { minR: 34, maxR: 62 });
  const { openCents } = pipelineTotals(leads);
  const openLabel = moneyShort(openCents);

  return (
    <Card label="BY SERVICE">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
        <svg
          viewBox="-70 -70 140 140"
          width={150}
          height={150}
          style={{ flexShrink: 0 }}
        >
          {wedges.map((w, i) => (
            <path
              key={w.service}
              d={w.path}
              fill={WEDGE_COLORS[i] ?? WEDGE_COLORS[WEDGE_COLORS.length - 1]}
              opacity={0.95 - i * 0.08}
            />
          ))}
          <circle r={17} cx={0} cy={0} fill={CARD_BG} />
          {/* Center label: Geist for numeric display */}
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={7}
            fontWeight={400}
            fontFamily={FONT_NUM}
            fill={CARD_FG}
          >
            {openLabel}
          </text>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {wedges.map((w, i) => (
            <div key={w.service} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
              <div
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  background: WEDGE_COLORS[i] ?? WEDGE_COLORS[WEDGE_COLORS.length - 1],
                  flexShrink: 0,
                }}
              />
              <span style={{ color: CARD_MUTED, fontFamily: FONT_BODY }}>
                {w.service} · {w.count} leads · {moneyShort(w.avgCents)} avg
              </span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: CARD_MUTED, opacity: 0.8, marginTop: 2, fontFamily: FONT_BODY }}>
            slice reach = average job size
          </div>
        </div>
      </div>
    </Card>
  );
}
