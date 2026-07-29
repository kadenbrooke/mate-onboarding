import Link from 'next/link';
import { Card } from '../Card';
import { scoreStats } from '@/lib/metrics/leads';
import {
  scoreColor, TRACK_BEIGE, TEXT_MUTED, NUM_DISPLAY, FONT_BODY, FONT_NUM,
} from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

// Hot leads + average lead quality on one card (2026-07 merge).
// Each lead's score is a traffic-light colored number (>=80 green, 60-79
// amber, <60 red); the semicircular average gauge sweeps in the same
// threshold color for the portfolio average.

function QualityArc({ avg }: { avg: number }) {
  const color = scoreColor(avg);
  const R = 40;
  const C = Math.PI * R; // semicircle length
  const fill = (Math.max(0, Math.min(100, avg)) / 100) * C;
  return (
    <svg viewBox="0 0 100 54" width={104} style={{ flexShrink: 0 }} data-testid="quality-arc">
      {/* Track: left (50-R,50) arc over the top to (50+R,50) */}
      <path
        d={`M ${50 - R} 50 A ${R} ${R} 0 0 1 ${50 + R} 50`}
        fill="none"
        stroke={TRACK_BEIGE}
        strokeWidth={9}
        strokeLinecap="round"
      />
      <path
        d={`M ${50 - R} 50 A ${R} ${R} 0 0 1 ${50 + R} 50`}
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={`${fill} ${C + 20}`}
      />
      <text
        x={50}
        y={44}
        textAnchor="middle"
        fontSize={20}
        fontWeight={300}
        fontFamily={FONT_NUM}
        fill={color}
      >
        {avg}
      </text>
    </svg>
  );
}

export function HotLeads({ leads, sessionId }: { leads: Lead[]; sessionId: string }) {
  const { hot, avg } = scoreStats(leads);

  return (
    <Card label="HOT RIGHT NOW">
      {/* Average lead quality gauge, merged from the old LEAD QUALITY card */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <QualityArc avg={avg} />
        <div style={{ fontSize: 10, color: TEXT_MUTED, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
          avg lead quality
        </div>
      </div>

      {hot.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 12, fontFamily: FONT_BODY }}>
          No uncontacted leads right now
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {hot.map(l => (
            <Link
              key={l.id}
              href={`/dash/${sessionId}/leads?spotlight=${l.id}`}
              // minHeight 44: each row is a full-size touch target on mobile
              style={{
                display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
                color: 'inherit', minHeight: 44, padding: '2px 0',
              }}
            >
              {/* Score as traffic-light colored number */}
              <span style={{
                ...NUM_DISPLAY,
                fontSize: 20,
                color: scoreColor(l.score!),
                minWidth: 34,
                textAlign: 'right',
                flexShrink: 0,
              }}>
                {l.score}
              </span>
              <div style={{ minWidth: 0 }}>
                {/* Lead name: DM Sans semibold, not Syne (not a section heading) */}
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14 }}>{l.name ?? 'Unknown'}</div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, fontFamily: FONT_BODY }}>
                  {[l.service, l.city].filter(Boolean).join(' · ')}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
