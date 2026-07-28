import { Card } from '../Card';
import { FREE_GREEN, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';

export function StreakCard({ streakDays }: { streakDays: number }) {
  const TRAIL_COUNT = 7;

  return (
    <Card
      label="THE STREAK"
      style={{
        background: 'linear-gradient(180deg,#12211a,#141414)',
        border: '1px solid #3aa76d44',
      }}
    >
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {/* Big stat */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{
            ...NUM_DISPLAY,
            fontSize: 44,
            color: FREE_GREEN,
            textShadow: `0 0 18px ${FREE_GREEN}80`,
            lineHeight: 1,
          }}>
            {streakDays}
          </span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: FREE_GREEN, opacity: 0.9 }}>
            days
          </span>
        </div>

        {/* Sub copy */}
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.7, textAlign: 'center' }}>
          without a single missed lead
        </div>

        {/* 7-dot trail */}
        <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
          {Array.from({ length: TRAIL_COUNT }, (_, i) => {
            const isLast = i === TRAIL_COUNT - 1;
            return (
              <div
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: FREE_GREEN,
                  opacity: isLast ? 1 : 0.4 + (i / TRAIL_COUNT) * 0.5,
                  boxShadow: isLast ? `0 0 8px ${FREE_GREEN}` : 'none',
                }}
              />
            );
          })}
        </div>
      </div>
    </Card>
  );
}
