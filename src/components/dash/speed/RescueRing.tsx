import { Card } from '../Card';
import { FREE_GREEN, CARD_BG, CARD_MUTED, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';

// Big-number treatment (2026-07, matches the old Streak card's style):
// the exact count of missed calls saved is the headline, not a donut split
// against calls that were never rescued -- one clear number reads faster
// than a ring segment did.

export function RescueRing({ rescued, missedTotal }: { rescued: number; missedTotal: number }) {
  return (
    <Card
      label="MISSED CALLS RESCUED"
      style={{
        background: `color-mix(in srgb, ${FREE_GREEN} 7%, ${CARD_BG})`,
        border: `1px solid color-mix(in srgb, ${FREE_GREEN} 25%, transparent)`,
      }}
    >
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <span style={{ ...NUM_DISPLAY, fontSize: 44, color: FREE_GREEN, lineHeight: 1 }}>
          {rescued}
        </span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: CARD_MUTED, textAlign: 'center' }}>
          of {missedTotal} missed calls became text conversations
        </div>
      </div>
    </Card>
  );
}
