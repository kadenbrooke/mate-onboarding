import { Card } from '../Card';
import { valueWheel, type Lead } from '@/lib/metrics/leads';
import { SERVICE_RAMP } from '@/lib/metrics/colors';
import { CARD_MUTED, FONT_BODY } from '@/lib/theme';

// One segmented proportion bar (like a stacked % bar) + legend. Leads with
// the mix/share story ("driveways are half our jobs") rather than exact
// counts, though counts + % both show in the legend. Replaced the donut
// wheel (2026-07): picked from three options Ben compared side by side.

export function ServiceShareBar({ leads }: { leads: Lead[] }) {
  const stats = valueWheel(leads).slice(0, 5);
  const total = stats.reduce((a, s) => a + s.count, 0) || 1;

  return (
    <Card label="SERVICE">
      {stats.length === 0 ? (
        <div style={{ fontSize: 11, color: CARD_MUTED, marginTop: 10, fontFamily: FONT_BODY }}>
          no service data yet
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', height: 16, borderRadius: 99, overflow: 'hidden', marginTop: 12 }}>
            {stats.map((s, i) => (
              <div
                key={s.service}
                style={{
                  width: `${(s.count / total) * 100}%`,
                  background: SERVICE_RAMP[i] ?? SERVICE_RAMP[SERVICE_RAMP.length - 1],
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
            {stats.map((s, i) => (
              <div key={s.service} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                <div style={{
                  width: 9, height: 9, borderRadius: 3, flexShrink: 0,
                  background: SERVICE_RAMP[i] ?? SERVICE_RAMP[SERVICE_RAMP.length - 1],
                }} />
                <span style={{ color: CARD_MUTED, fontFamily: FONT_BODY }}>
                  {s.service} · {s.count} jobs · {Math.round((s.count / total) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
