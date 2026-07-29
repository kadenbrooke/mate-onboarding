import { Card } from '../Card';
import { CascadeFunnel } from './CascadeFunnel';
import type { Reactivation, ReactivationWin } from '../types';
import { FREE_GREEN, CARD_MUTED, NUM_DISPLAY, NUM_TABLE, FONT_BODY } from '@/lib/theme';
import { BRAND_RAMP } from '@/lib/metrics/colors';
import { moneyShort } from '@/lib/metrics/format';

// Purple used for "replied" states matches the web_form categorical hue
// (legible on white, unlike the old pastel #b586e8).
const REPLIED_PURPLE = '#7d5bbe';

export function FollowUpZone({
  reactivation,
  wins,
  showLabel = true,
}: {
  reactivation: Reactivation | null;
  wins: ReactivationWin[];
  showLabel?: boolean;
}) {
  // Desktop suppresses the card label: the surrounding SectionCard carries it.
  const label = showLabel ? 'FOLLOW-UP ENGINE' : undefined;
  if (reactivation == null) {
    return (
      <Card label={label} themeKey="follow-up-engine">
        <div style={{ color: CARD_MUTED, fontSize: 12, marginTop: 10, fontFamily: FONT_BODY }}>
          turns on with the Reactivator
        </div>
      </Card>
    );
  }

  const {
    pool_size, contacted, replied, rebooked, recovered_cents,
    dormancy_3_6mo, dormancy_6_12mo, dormancy_1_2yr, dormancy_2yr_plus,
  } = reactivation;

  const dormancyCounts = [dormancy_3_6mo, dormancy_6_12mo, dormancy_1_2yr, dormancy_2yr_plus];
  const dormancyLabels = ['3-6mo', '6-12mo', '1-2yr', '2yr+'];
  const dormancyMax = Math.max(1, ...dormancyCounts);
  const BAR_MAX_H = 56;
  const BAR_MIN_H = 6;

  return (
    <Card label={label} themeKey="follow-up-engine">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 10 }}>
        {/* Cascade funnel */}
        <CascadeFunnel stages={[
          { label: 'Database', count: pool_size },
          { label: 'Contacted', count: contacted },
          { label: 'Replied', count: replied },
          { label: 'Rebooked', count: rebooked, highlight: 'green' },
        ]} />

        {/* Recovered revenue */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            ...NUM_DISPLAY,
            fontSize: 24,
            color: FREE_GREEN,
          }}>
            {moneyShort(recovered_cents)}
          </div>
          <div style={{ fontSize: 10, color: CARD_MUTED, marginTop: 2 }}>recovered revenue</div>
        </div>

        {/* Dormancy bar chart */}
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: 1.5,
            color: CARD_MUTED,
            marginBottom: 8,
          }}>
            CONTACTS BY DORMANCY
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', justifyContent: 'space-around' }}>
            {dormancyCounts.map((count, i) => {
              const h = Math.max(BAR_MIN_H, (count / dormancyMax) * BAR_MAX_H);
              return (
                <div key={dormancyLabels[i]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                  <div style={{
                    width: '100%',
                    height: h,
                    background: BRAND_RAMP[i],
                    borderRadius: '5px 5px 2px 2px',
                  }} />
                  <div style={{ fontSize: 9, color: CARD_MUTED }}>{dormancyLabels[i]}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent wins */}
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: CARD_MUTED, marginBottom: 6 }}>
            RECENT WINS
          </div>
          {wins.length === 0 ? (
            <div style={{ fontSize: 11, color: CARD_MUTED }}>No wins yet, the machine is working</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wins.map(w => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  {/* State indicator circle */}
                  <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: w.state === 'won' ? FREE_GREEN : REPLIED_PURPLE,
                    flexShrink: 0,
                  }} />
                  {/* Name + dormancy */}
                  <span style={{ flex: 1 }}>
                    <b>{w.customer_name}</b>
                    {w.dormant_months != null && (
                      <span style={{ color: CARD_MUTED }}>{' '}&middot; {w.dormant_months}mo dormant</span>
                    )}
                  </span>
                  {/* Right side: money or replied */}
                  {w.state === 'won' && w.won_cents != null ? (
                    <span style={{ ...NUM_TABLE, color: FREE_GREEN }}>
                      {moneyShort(w.won_cents)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: REPLIED_PURPLE }}>Replied</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
