import { Card } from '@/components/dash/Card';
import { CascadeFunnel } from '../followup/CascadeFunnel';
import { StarBars } from './StarBars';
import { ReferralRing } from './ReferralRing';
import { FREE_GREEN, CARD_MUTED, CARD_BG, CARD_INSET, CARD_HAIRLINE, FONT_BODY, FONT_HEAD } from '@/lib/theme';
import type { Reputation, Review } from '@/components/dash/types';

export function ReputationZone({
  reputation,
  reviews,
  showLabel = true,
}: {
  reputation: Reputation | null;
  reviews: Review[];
  showLabel?: boolean;
}) {
  // Desktop suppresses the card label: the surrounding SectionCard carries it.
  const label = showLabel ? 'THE REPUTATION MACHINE' : undefined;
  if (reputation == null) {
    return (
      <Card label={label} themeKey="the-reputation-machine">
        <div style={{ color: CARD_MUTED, fontSize: 12, marginTop: 10, fontFamily: FONT_BODY }}>
          turns on with review collection
        </div>
      </Card>
    );
  }

  const safeReviews = reviews ?? [];

  return (
    <Card label={label} themeKey="the-reputation-machine">
      {/* Twin cascades: 2-col grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
        {/* Left: REVIEWS cascade */}
        <div>
          <div style={{
            fontSize: 10, letterSpacing: 1.5, color: CARD_MUTED,
            fontFamily: FONT_HEAD, fontFeatureSettings: '"ss04"', marginBottom: 8,
          }}>
            REVIEWS
          </div>
          <CascadeFunnel stages={[
            { label: 'Jobs done', count: reputation.jobs_done },
            { label: 'Asked', count: reputation.rate_asks },
            { label: 'Rated 4-5', count: reputation.rated_45 },
            { label: 'Google', count: reputation.on_google, highlight: 'brand' },
          ]} />
        </div>

        {/* Right: REFERRALS cascade */}
        <div>
          <div style={{
            fontSize: 10, letterSpacing: 1.5,
            color: FREE_GREEN, fontFamily: FONT_HEAD, fontFeatureSettings: '"ss04"', marginBottom: 8,
          }}>
            REFERRALS
          </div>
          <CascadeFunnel stages={[
            { label: 'Asked to refer', count: reputation.refer_asks },
            { label: 'Received', count: reputation.referrals_in },
            { label: 'Closed', count: reputation.referrals_closed, highlight: 'green' },
          ]} />
        </div>
      </div>

      {/* Bottom: StarBars + ReferralRing sub-panels. Mobile stacks them: the
          ReferralRing's 110px donut + revenue block overflows a half column. */}
      <style>{`
        @media (max-width: 640px) { .rep-panels { grid-template-columns: 1fr !important; } }
      `}</style>
      <div className="rep-panels" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        <div style={{
          border: `1px solid ${CARD_HAIRLINE}`, borderRadius: 12, padding: 14,
          background: CARD_INSET,
        }}>
          <StarBars reviews={safeReviews} avgRating={reputation.avg_rating} />
        </div>

        <div style={{
          border: `1px solid color-mix(in srgb, ${FREE_GREEN} 25%, transparent)`, borderRadius: 12, padding: 14,
          background: `color-mix(in srgb, ${FREE_GREEN} 6%, ${CARD_BG})`,
        }}>
          <ReferralRing reputation={reputation} />
        </div>
      </div>
    </Card>
  );
}
