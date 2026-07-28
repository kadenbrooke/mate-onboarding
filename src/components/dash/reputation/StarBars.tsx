import {
  NUM_DISPLAY, NUM_TABLE, FONT_BODY, FONT_HEAD, brandVar, TRACK_BEIGE, TEXT_MUTED,
} from '@/lib/theme';
import type { Review } from '@/components/dash/types';

// Star glyph rows for Google rating distribution.
// 5 rows 5-down-to-1, using the ★ unicode glyph (text character, not emoji).

function starFill(star: number): string {
  if (star === 5) return `linear-gradient(90deg, #b8400f, ${brandVar})`;
  if (star === 4) return '#b86a4a';
  return '#b8b0a4';
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
        <span style={{ fontSize: 10, letterSpacing: 1.5, color: TEXT_MUTED, fontFamily: FONT_HEAD, fontFeatureSettings: '"ss04"' }}>
          GOOGLE RATING
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 20, ...NUM_DISPLAY }}>
            {avgRating != null ? avgRating.toFixed(1) : '--'}
          </span>
          <span style={{ fontSize: 10, color: TEXT_MUTED, fontFamily: FONT_BODY }}>
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
              <div style={{ flex: 1, height: 8, background: TRACK_BEIGE, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: starFill(star),
                  borderRadius: 4,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              {/* Count */}
              <span style={{ fontSize: 10, color: TEXT_MUTED, width: 22, textAlign: 'right', flexShrink: 0, ...NUM_TABLE }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
