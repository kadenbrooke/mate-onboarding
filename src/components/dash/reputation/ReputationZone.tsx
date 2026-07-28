import { Card } from '@/components/dash/Card';
import { CascadeFunnel } from '../followup/CascadeFunnel';
import { StarBars } from './StarBars';
import { ReferralRing } from './ReferralRing';
import { FREE_GREEN, FONT_BODY, FONT_HEAD } from '@/lib/theme';
import type { Reputation, Review } from '@/components/dash/types';

export function ReputationZone({
  reputation,
  reviews,
}: {
  reputation: Reputation | null;
  reviews: Review[];
}) {
  if (reputation == null) {
    return (
      <Card label="THE REPUTATION MACHINE">
        <div style={{ opacity: 0.45, fontSize: 12, marginTop: 10, fontFamily: FONT_BODY }}>
          turns on with review collection
        </div>
      </Card>
    );
  }

  const safeReviews = reviews ?? [];

  return (
    <Card label="THE REPUTATION MACHINE">
      {/* Twin cascades: 2-col grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
        {/* Left: REVIEWS cascade */}
        <div>
          <div style={{
            fontSize: 10, letterSpacing: 1.5, opacity: 0.55,
            fontFamily: FONT_HEAD, marginBottom: 8,
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
            color: FREE_GREEN, fontFamily: FONT_HEAD, marginBottom: 8,
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

      {/* Bottom: StarBars + ReferralRing */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        {/* Star bars sub-card */}
        <div style={{
          border: '1px solid #2a2a2a', borderRadius: 12, padding: 14,
          background: 'linear-gradient(180deg,#1c1c1c,#141414)',
        }}>
          <StarBars reviews={safeReviews} avgRating={reputation.avg_rating} />
        </div>

        {/* Referral ring sub-card (green-tinted like StreakCard) */}
        <div style={{
          border: '1px solid #3aa76d44', borderRadius: 12, padding: 14,
          background: 'linear-gradient(180deg,#12211a,#141414)',
        }}>
          <ReferralRing reputation={reputation} />
        </div>
      </div>
    </Card>
  );
}
