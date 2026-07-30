import { Card } from '../Card';
import { areaRanking } from '@/lib/metrics/leads';
import type { Lead } from '@/lib/metrics/leads';
import { brandVar, CARD_TRACK, CARD_MUTED, NUM_TABLE, FONT_BODY } from '@/lib/theme';

// Horizontal bar chart of lead counts by city: label left, rounded bar on a
// beige track, count right. Replaced the concentric "racetrack" rings
// (2026-07 redesign) which hid the actual proportions.

const MAX_ROWS = 5;

export function AreaBars({ leads }: { leads: Lead[] }) {
  const areas = areaRanking(leads).slice(0, MAX_ROWS);
  const max = areas.length > 0 ? areas[0].count : 1;

  return (
    <Card label="BY AREA">
      {areas.length === 0 ? (
        <div style={{ fontSize: 11, color: CARD_MUTED, marginTop: 10, fontFamily: FONT_BODY }}>
          no area data yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {areas.map(a => (
            <div key={a.city} data-testid={`area-bar-${a.city}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 11, fontFamily: FONT_BODY, width: 72, flexShrink: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {a.city}
              </span>
              <div style={{ flex: 1, height: 10, background: CARD_TRACK, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(4, (a.count / max) * 100)}%`,
                  height: '100%',
                  background: brandVar,
                  borderRadius: 99,
                }} />
              </div>
              <span style={{ ...NUM_TABLE, fontSize: 11, width: 22, textAlign: 'right', flexShrink: 0 }}>
                {a.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
