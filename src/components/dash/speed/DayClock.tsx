import { Card } from '../Card';
import { peakBucketRange, type TimeBucket } from '@/lib/metrics/speed';
import { brandVar, CARD_TRACK, CARD_MUTED, FONT_BODY, NUM_DISPLAY } from '@/lib/theme';

// Time-of-day histogram: 8 bars (3-hour windows) across the day, tallest
// bar highlighted so the busiest window reads at a glance. Replaced the
// after-hours/work-hours ring (2026-07): the ring only ever showed two
// buckets, which hid exactly the "when" a client actually asks about.

const BAR_AREA_H = 56;

export function DayClock({ buckets }: { buckets: TimeBucket[] }) {
  const max = Math.max(...buckets.map(b => b.count), 1);
  const peakRange = peakBucketRange(buckets);

  return (
    <Card label="WHEN LEADS ARRIVE">
      {peakRange ? (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ ...NUM_DISPLAY, fontSize: 20, color: brandVar }}>{peakRange}</span>
          <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: CARD_MUTED }}>busiest window</span>
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 12, color: CARD_MUTED, fontFamily: FONT_BODY }}>
          no leads yet
        </div>
      )}
      <div
        data-testid="dayclock-bars"
        style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: BAR_AREA_H + 16, marginTop: 12 }}
      >
        {buckets.map(b => {
          const isPeak = peakRange !== null && b.count === max && b.count > 0;
          const h = b.count > 0 ? Math.max(6, (b.count / max) * BAR_AREA_H) : 4;
          return (
            <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
              <div
                data-testid={`dayclock-bar-${b.startHour}`}
                data-count={b.count}
                style={{
                  width: '100%',
                  height: h,
                  background: isPeak ? brandVar : CARD_TRACK,
                  borderRadius: b.count > 0 ? '5px 5px 2px 2px' : 3,
                }}
              />
              <span style={{ fontSize: 8, color: CARD_MUTED, fontFamily: FONT_BODY, whiteSpace: 'nowrap' }}>
                {b.label}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
