import { Card } from '../Card';
import { brandVar, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';
import { ringSegments } from '@/lib/metrics/ring';

export function RescueRing({ rescued, missedTotal }: { rescued: number; missedTotal: number }) {
  const radius = 40;
  const lost = Math.max(0, missedTotal - rescued);
  const segs = ringSegments(
    [{ key: 'rescued', value: rescued }, { key: 'lost', value: lost }],
    radius,
    2,
  );
  const circ = 2 * Math.PI * radius;

  return (
    <Card label="MISSED CALLS RESCUED">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
        {/* Donut */}
        <svg width={96} height={96} viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
          <g transform="translate(48,48) rotate(-90)">
            {segs.map(seg => {
              const isRescued = seg.key === 'rescued';
              return (
                <circle
                  key={seg.key}
                  r={radius}
                  cx={0}
                  cy={0}
                  fill="none"
                  stroke={isRescued ? brandVar : '#2a2a2a'}
                  strokeWidth={12}
                  strokeDasharray={`${seg.dash} ${circ}`}
                  strokeDashoffset={seg.offset}
                  style={isRescued ? { filter: `drop-shadow(0 0 6px ${brandVar})` } : undefined}
                />
              );
            })}
          </g>
          {/* Center text */}
          <text
            x={48}
            y={44}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={18}
            fontWeight={300}
            fontFamily={NUM_DISPLAY.fontFamily as string}
            fill={brandVar}
          >
            {rescued}
          </text>
          <text
            x={48}
            y={60}
            textAnchor="middle"
            fontSize={7}
            letterSpacing={1}
            fontFamily={FONT_BODY}
            fill={brandVar}
            opacity={0.8}
          >
            SAVED
          </text>
        </svg>

        {/* Right copy */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600 }}>{rescued} of {missedTotal}</span> missed calls became text conversations
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.5 }}>
            gap = calls that never replied
          </div>
        </div>
      </div>
    </Card>
  );
}
