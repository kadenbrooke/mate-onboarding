'use client';
import { useEffect, useState } from 'react';
import { Card } from '../Card';
import { FREE_GREEN, brandVar, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';

function isNightHour(h: number): boolean {
  return h < 6 || h >= 18;
}

export function DayClock({ hourCounts, afterHoursCount }: { hourCounts: number[]; afterHoursCount: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div style={{ height: 190 }} />;

  const r = 70;
  const cx = 75;
  const cy = 75;

  // Night wedge path helper: arc from startDeg to endDeg (degrees, 0 = top/north)
  function wedgePath(startDeg: number, endDeg: number): string {
    const toRad = (d: number) => (d - 90) * (Math.PI / 180);
    const x1 = cx + r * Math.cos(toRad(startDeg));
    const y1 = cy + r * Math.sin(toRad(startDeg));
    const x2 = cx + r * Math.cos(toRad(endDeg));
    const y2 = cy + r * Math.sin(toRad(endDeg));
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
  }

  // 24-hour clock: each hour = 15 degrees, 0 = midnight at top
  const spokes = hourCounts.map((count, h) => {
    const angleDeg = h * 15; // degrees from top (midnight)
    const night = isNightHour(h);
    const spokeHeight = 6 + Math.min(28, count * 8);
    const fill = night ? FREE_GREEN : brandVar;
    const glowFilter = night && count > 0 ? `drop-shadow(0 0 4px ${FREE_GREEN})` : 'none';
    return { h, angleDeg, count, spokeHeight, fill, night, glowFilter };
  });

  return (
    <Card label="WHEN LEADS ARRIVE">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        {/* SVG Clock */}
        <svg width={150} height={150} viewBox="0 0 150 150" style={{ flexShrink: 0 }}>
          {/* Base circle */}
          <circle cx={cx} cy={cy} r={r} fill="#101418" />

          {/* Night wedge 18:00-24:00 (270deg to 360deg) */}
          <path d={wedgePath(270, 360)} fill="#1a2030" opacity={0.7} />
          {/* Night wedge 0:00-6:00 (0deg to 90deg) */}
          <path d={wedgePath(0, 90)} fill="#1a2030" opacity={0.7} />

          {/* Spokes */}
          <g transform={`translate(${cx},${cy})`}>
            {spokes.map(({ h, angleDeg, spokeHeight, fill, count, glowFilter }) => (
              count > 0 ? (
                <g key={h} transform={`rotate(${angleDeg})`} style={{ filter: glowFilter }}>
                  <rect
                    x={-2.5}
                    y={-r + 2}
                    width={5}
                    height={spokeHeight}
                    rx={2}
                    fill={fill}
                    opacity={0.9}
                  />
                </g>
              ) : (
                <g key={h} transform={`rotate(${angleDeg})`}>
                  <rect
                    x={-1}
                    y={-r + 2}
                    width={2}
                    height={4}
                    rx={1}
                    fill="#2a2a2a"
                  />
                </g>
              )
            ))}
          </g>

          {/* Labels: 12a top, 12p bottom */}
          <text x={cx} y={10} textAnchor="middle" fontSize={8} fill="#556" fontFamily={FONT_BODY}>
            12a
          </text>
          <text x={cx} y={145} textAnchor="middle" fontSize={8} fill="#556" fontFamily={FONT_BODY}>
            12p
          </text>
        </svg>

        {/* Right side stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ ...NUM_DISPLAY, fontSize: 24, color: FREE_GREEN, textShadow: `0 0 12px ${FREE_GREEN}60` }}>
            {afterHoursCount}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.7 }}>
            caught nights + weekends
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10, opacity: 0.45, marginTop: 4 }}>
            spokes = leads per hour, green = after hours
          </div>
        </div>
      </div>
    </Card>
  );
}
