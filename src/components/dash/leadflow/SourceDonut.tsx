import { Card } from '../Card';
import { sourceBreakdown } from '@/lib/metrics/leads';
import { ringSegments } from '@/lib/metrics/ring';
import { FREE_GREEN } from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

const SOURCE_COLORS: Record<string, string> = {
  missed_call: '#555',
  texted_in: '#777',
  web_form: '#999',
  referral: '#2e8b57',
  revived: FREE_GREEN,
  unknown: '#444',
};

const SOURCE_LABELS: Record<string, string> = {
  missed_call: 'Missed call',
  texted_in: 'Texted in',
  web_form: 'Web form',
  referral: 'Referral',
  revived: 'Revived',
  unknown: 'Other',
};

const FREE_SOURCES = new Set(['referral', 'revived']);

export function SourceDonut({ leads }: { leads: Lead[] }) {
  const { segments, freeCount } = sourceBreakdown(leads);
  const radius = 40;
  const ringInputs = segments.map(s => ({ key: s.source, value: s.count }));
  const segs = ringSegments(ringInputs, radius, 2);
  const circ = 2 * Math.PI * radius;

  return (
    <Card label="WHERE THEY CAME FROM">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
        <svg width={100} height={100} viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
          <g transform="translate(50,50) rotate(-90)">
            {segs.map(seg => {
              const color = SOURCE_COLORS[seg.key] ?? '#444';
              return (
                <circle
                  key={seg.key}
                  r={radius}
                  cx={0}
                  cy={0}
                  fill="none"
                  stroke={color}
                  strokeWidth={12}
                  strokeDasharray={`${seg.dash} ${circ}`}
                  strokeDashoffset={seg.offset}
                />
              );
            })}
          </g>
          {/* Center label */}
          <text
            x={50}
            y={47}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={20}
            fontWeight={800}
            fill={FREE_GREEN}
          >
            {freeCount}
          </text>
          <text
            x={50}
            y={62}
            textAnchor="middle"
            fontSize={8}
            letterSpacing={1}
            fill={FREE_GREEN}
          >
            FREE
          </text>
        </svg>

        {/* Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {segments.map(s => {
            const color = SOURCE_COLORS[s.source] ?? '#444';
            const isFree = FREE_SOURCES.has(s.source);
            return (
              <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9 }}>
                <div
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 2,
                    background: color,
                    boxShadow: isFree ? `0 0 6px ${color}` : 'none',
                    flexShrink: 0,
                  }}
                />
                <span style={{ opacity: 0.75 }}>
                  {SOURCE_LABELS[s.source] ?? s.source}
                  {' '}
                  <span style={{ opacity: 0.65 }}>({s.count})</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
