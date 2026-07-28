import Link from 'next/link';
import { Card } from '../Card';
import { scoreStats } from '@/lib/metrics/leads';
import { brandVar, NUM_TABLE, FONT_BODY } from '@/lib/theme';
import type { Lead } from '@/lib/metrics/leads';

function ScoreRing({ score }: { score: number }) {
  const deg = score * 3.6;
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: `conic-gradient(${brandVar} ${deg}deg, #2a2a2a ${deg}deg)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: '#141414',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          color: '#fff',
          ...NUM_TABLE,
        }}
      >
        {score}
      </div>
    </div>
  );
}

export function HotLeads({ leads, sessionId }: { leads: Lead[]; sessionId: string }) {
  const { hot } = scoreStats(leads);

  return (
    <Card label="HOT RIGHT NOW">
      {hot.length === 0 ? (
        <div style={{ opacity: 0.5, fontSize: 12, marginTop: 10 }}>No uncontacted leads right now</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {hot.map(l => (
            <Link
              key={l.id}
              href={`/dash/${sessionId}/leads?spotlight=${l.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}
            >
              <ScoreRing score={l.score!} />
              <div>
                {/* Lead name: DM Sans semibold, not Syne (not a section heading) */}
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, color: '#fff' }}>{l.name ?? 'Unknown'}</div>
                <div style={{ fontSize: 11, opacity: 0.55, fontFamily: FONT_BODY }}>
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
