import { Card } from '../Card';
import { FREE_GREEN, CARD_BG, CARD_MUTED, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';

export function StreakCard({ streakDays }: { streakDays: number }) {
  const TRAIL_COUNT = 7;

  return (
    <Card
      label="THE STREAK"
      style={{
        background: `color-mix(in srgb, ${FREE_GREEN} 7%, ${CARD_BG})`,
        border: `1px solid color-mix(in srgb, ${FREE_GREEN} 25%, transparent)`,
      }}
    >
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {/* Big stat */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{
            ...NUM_DISPLAY,
            fontSize: 44,
            color: FREE_GREEN,
            lineHeight: 1,
          }}>
            {streakDays}
          </span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: FREE_GREEN, opacity: 0.9 }}>
            days
          </span>
        </div>

        {/* Sub copy */}
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: CARD_MUTED, textAlign: 'center' }}>
          without a single missed lead
        </div>

        {/* 7-dot trail */}
        <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
          {Array.from({ length: TRAIL_COUNT }, (_, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: FREE_GREEN,
                opacity: 0.4 + (i / (TRAIL_COUNT - 1)) * 0.6,
              }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
