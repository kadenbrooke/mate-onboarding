import { Card } from '../Card';
import { FREE_GREEN, CARD_BG, CARD_MUTED, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';

// Big-number treatment (2026-07, matches the old Streak card's style):
// the exact count of missed calls saved is the headline, not a donut split
// against calls that were never rescued -- one clear number reads faster
// than a ring segment did.

// `missedTotal` is null when nothing independently records missed calls for this
// session. The rescue stat is a RATE, and a rate with no denominator is not a
// smaller stat, it is no stat: the card says so rather than rendering the
// numerator against itself as "N of N rescued".

export function RescueRing({ rescued, missedTotal }: {
  rescued: number; missedTotal: number | null;
}) {
  return (
    <Card
      label="MISSED CALLS RESCUED"
      style={{
        background: `color-mix(in srgb, ${FREE_GREEN} 7%, ${CARD_BG})`,
        border: `1px solid color-mix(in srgb, ${FREE_GREEN} 25%, transparent)`,
      }}
    >
      {missedTotal == null ? (
        <div style={{
          marginTop: 12, fontFamily: FONT_BODY, fontSize: 12, color: CARD_MUTED, lineHeight: 1.5,
        }}>
          not tracking missed calls yet
          <div style={{ fontSize: 11, marginTop: 4 }}>
            this fills in once call tracking is connected
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ ...NUM_DISPLAY, fontSize: 44, color: FREE_GREEN, lineHeight: 1 }}>
            {rescued}
          </span>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: CARD_MUTED, textAlign: 'center' }}>
            of {missedTotal} missed calls became text conversations
          </div>
        </div>
      )}
    </Card>
  );
}
