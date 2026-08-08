import { moneyShort } from '@/lib/metrics/format';
import { RingStat } from '../RingStat';
import { FREE_GREEN, LOST_BROWN, brandVar, NUM_DISPLAY, FONT_HEAD } from '@/lib/theme';
import type { Reputation } from '@/components/dash/types';

type RingKey = 'won' | 'lost' | 'open';

const SEG_COLOR: Record<RingKey, string> = {
  won: FREE_GREEN,
  lost: LOST_BROWN,
  open: brandVar,
};

const SEG_LABEL: Record<RingKey, string> = {
  won: 'WON',
  lost: 'LOST',
  open: 'OPEN',
};

export function ReferralRing({ reputation }: { reputation: Reputation }) {
  const { referrals_closed, referrals_lost, referrals_in, referral_revenue_cents } = reputation;
  const open = Math.max(0, referrals_in - referrals_closed - referrals_lost);
  const counts: Record<RingKey, number> = { won: referrals_closed, lost: referrals_lost, open };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <RingStat
        idPrefix="referral"
        size={100}
        segments={(['won', 'lost', 'open'] as RingKey[]).map(k => ({
          key: k,
          label: SEG_LABEL[k],
          value: counts[k],
          display: String(counts[k]),
          color: SEG_COLOR[k],
        }))}
        center={{ label: 'WON', display: String(counts.won), color: SEG_COLOR.won }}
        ariaLabel={`Referrals: won ${counts.won}, lost ${counts.lost}, open ${counts.open}`}
        aside={
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: FREE_GREEN, fontFamily: FONT_HEAD, fontFeatureSettings: '"ss04"', marginBottom: 2 }}>
              REFERRAL WINS
            </div>
            <div style={{ fontSize: 24, ...NUM_DISPLAY, color: FREE_GREEN, lineHeight: 1.1 }}>
              {moneyShort(referral_revenue_cents)}
            </div>
          </div>
        }
      />
    </div>
  );
}
