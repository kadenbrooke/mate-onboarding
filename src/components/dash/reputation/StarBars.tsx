import { NUM_DISPLAY, NUM_TABLE, FONT_BODY, FONT_HEAD, brandVar } from '@/lib/theme';
import type { Review } from '@/components/dash/types';

// Star glyph rows for Google rating distribution.
// 5 rows 5-down-to-1, using the ★ unicode glyph (text character, not emoji).

const STAR_COLORS: Record<number, string> = {
  5: brandVar,           // brand gradient via fill on track
  4: '#b86a4a',
  3: '#555',
  2: '#555',
  1: '#555',
};

function starFill(star: number): string {
  if (star === 5) return `linear-gradient(90deg, #8a2f0f, ${brandVar})`;
  return STAR_COLORS[star];
}

function starGlow(star: number): string | undefined {
  if (star === 5) return `0 0 8px ${brandVar}66`;
  return undefined;
}

export function StarBars({
  reviews,
  avgRating,
}: {
  reviews: Review[];
  avgRating: number | null;
}) {
  // Count reviews per star rating
  const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of reviews) {
    if (r.rating >= 1 && r.rating <= 5) counts[r.rating]++;
  }
  const maxCount = Math.max(1, ...Object.values(counts));
  const total = reviews.length;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: 1.5, opacity: 0.55, fontFamily: FONT_HEAD }}>
          GOOGLE RATING
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 20, ...NUM_DISPLAY }}>
            {avgRating != null ? avgRating.toFixed(1) : '--'}
          </span>
          <span style={{ fontSize: 10, opacity: 0.5, fontFamily: FONT_BODY }}>
            ({total})
          </span>
        </div>
      </div>

      {/* Bar rows 5 down to 1 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {([5, 4, 3, 2, 1] as const).map((star) => {
          const count = counts[star];
          const pct = Math.round((count / maxCount) * 100);
          return (
            <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Star label */}
              <span style={{ fontSize: 10, width: 20, textAlign: 'right', fontFamily: FONT_BODY, flexShrink: 0 }}>
                {star}★
              </span>
              {/* Track */}
              <div style={{ flex: 1, height: 8, background: '#222', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: starFill(star),
                  borderRadius: 4,
                  boxShadow: starGlow(star),
                  transition: 'width 0.3s ease',
                }} />
              </div>
              {/* Count */}
              <span style={{ fontSize: 10, opacity: 0.6, width: 22, textAlign: 'right', flexShrink: 0, ...NUM_TABLE }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
