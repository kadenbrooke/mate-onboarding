import { Card } from '../Card';
import { areaRanking } from '@/lib/metrics/leads';
import type { Lead } from '@/lib/metrics/leads';

const TRACK_COLORS = [
  'var(--brand-primary, #e14d1a)',
  '#e1774d',
  '#b86a4a',
  '#8a5a42',
];

const RADII = [56, 44, 32, 20];

export function AreaRacetrack({ leads }: { leads: Lead[] }) {
  const areas = areaRanking(leads).slice(0, 4);
  const max = areas.length > 0 ? areas[0].count : 1;

  return (
    <Card label="BY AREA">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
        <svg
          width={140}
          height={140}
          viewBox="0 0 140 140"
          style={{ flexShrink: 0 }}
        >
          <g transform="translate(70,70)">
            {RADII.map((r, i) => {
              const area = areas[i];
              const C = 2 * Math.PI * r;
              const arcLength = area ? (area.count / max) * C * 0.75 : 0;
              const color = TRACK_COLORS[i] ?? TRACK_COLORS[TRACK_COLORS.length - 1];

              return (
                <g key={i}>
                  {/* Background track */}
                  <circle
                    r={r}
                    cx={0}
                    cy={0}
                    fill="none"
                    stroke="#232323"
                    strokeWidth={9}
                  />
                  {/* Arc fill */}
                  {area && (
                    <circle
                      r={r}
                      cx={0}
                      cy={0}
                      fill="none"
                      stroke={color}
                      strokeWidth={9}
                      strokeLinecap="round"
                      strokeDasharray={`${arcLength} ${C}`}
                      transform="rotate(-90)"
                      style={
                        i === 0
                          ? { filter: `drop-shadow(0 0 4px ${color})` }
                          : undefined
                      }
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {areas.map((a, i) => {
            const color = TRACK_COLORS[i] ?? TRACK_COLORS[TRACK_COLORS.length - 1];
            return (
              <div key={a.city} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ opacity: 0.75 }}>
                  {a.city}
                  {' '}
                  <span style={{ fontWeight: 700, opacity: 1 }}>{a.count}</span>
                </span>
              </div>
            );
          })}
          {areas.length === 0 && (
            <span style={{ fontSize: 9, opacity: 0.4 }}>no area data</span>
          )}
        </div>
      </div>
    </Card>
  );
}
