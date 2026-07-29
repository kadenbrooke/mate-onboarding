import { Card } from '../Card';
import { sourceBreakdown } from '@/lib/metrics/leads';
import { ringSegments } from '@/lib/metrics/ring';
import { SOURCE_COLORS, SOURCE_LABELS } from '@/lib/metrics/colors';
import { FREE_GREEN, TEXT_MUTED, NUM_TABLE, FONT_NUM, FONT_BODY } from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

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
              const color = SOURCE_COLORS[seg.key] ?? SOURCE_COLORS.unknown;
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
          {/* Center label: Geist 300 pnum for standalone display stat */}
          <text
            x={50}
            y={47}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={20}
            fontWeight={300}
            fontFamily={FONT_NUM}
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
            fontFamily={FONT_BODY}
            fill={FREE_GREEN}
          >
            FREE
          </text>
        </svg>

        {/* Legend: swatches match segment hues exactly */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {segments.map(s => {
            const color = SOURCE_COLORS[s.source] ?? SOURCE_COLORS.unknown;
            return (
              <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                <div
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 3,
                    background: color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: TEXT_MUTED, fontFamily: FONT_BODY }}>
                  {SOURCE_LABELS[s.source] ?? s.source}
                  {' '}
                  <span style={{ ...NUM_TABLE }}>{s.count}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
