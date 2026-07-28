import { Card } from '../Card';
import { valueWheel, pipelineTotals } from '@/lib/metrics/leads';
import { wheelWedges } from '@/lib/metrics/wheel';
import type { Lead } from '@/lib/metrics/leads';

const WEDGE_COLORS = [
  'var(--brand-primary, #e14d1a)',
  '#e1774d',
  '#b86a4a',
  '#8a5a42',
  '#6a4a38',
];

function money(cents: number): string {
  return '$' + (cents / 100000).toFixed(1) + 'k';
}

export function ValueWheel({ leads }: { leads: Lead[] }) {
  const stats = valueWheel(leads).slice(0, 5);
  const wedges = wheelWedges(stats, { minR: 34, maxR: 62 });
  const { openCents } = pipelineTotals(leads);
  const openLabel = '$' + (openCents / 100000).toFixed(1) + 'k';

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
          <circle r={16} cx={0} cy={0} fill="#141414" />
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={7}
            fontWeight={700}
            fill="#fff"
          >
            {openLabel}
          </text>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {wedges.map((w, i) => (
            <div key={w.service} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9 }}>
              <div
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: WEDGE_COLORS[i] ?? WEDGE_COLORS[WEDGE_COLORS.length - 1],
                  flexShrink: 0,
                }}
              />
              <span style={{ opacity: 0.75 }}>
                {w.service}
                {' '}
                <span style={{ opacity: 0.65 }}>{w.count} leads</span>
                {' '}
                <span style={{ opacity: 0.55 }}>{money(w.avgCents)} avg</span>
              </span>
            </div>
          ))}
          <div style={{ fontSize: 10, opacity: 0.45, marginTop: 2 }}>
            slice reach = average job size
          </div>
        </div>
      </div>
    </Card>
  );
}
