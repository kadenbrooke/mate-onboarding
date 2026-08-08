import { pipelineTotals, type Lead } from '@/lib/metrics/leads';
import { Card } from '../Card';
import { RingStat } from '../RingStat';
import { FREE_GREEN, LOST_BROWN, brandVar, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';
import { moneyShort } from '@/lib/metrics/format';

type Seg = 'won' | 'lost' | 'open';

const SEG_COLOR: Record<Seg, string> = {
  won: FREE_GREEN,
  lost: LOST_BROWN,
  open: brandVar,
};

const SEG_LABEL: Record<Seg, string> = {
  won: 'WON',
  lost: 'LOST',
  open: 'ON THE TABLE',
};

export function TwinRings({ leads, showLabel = true }: { leads: Lead[]; showLabel?: boolean }) {
  const t = pipelineTotals(leads);
  const quotedTotal = t.wonCents + t.lostCents + t.openCents;
  const avgJob = t.counts.won ? Math.round(t.wonCents / t.counts.won) : 0;

  const revenue = { won: t.wonCents, lost: t.lostCents, open: t.openCents };
  const counts = t.counts;

  return (
    <Card label={showLabel ? 'THE PIPELINE' : undefined} themeKey="the-pipeline">
      <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
        {/* Revenue ring: WON / LOST / ON THE TABLE by quote value. Rests on WON. */}
        <RingStat
          idPrefix="rev"
          caption="REVENUE"
          segments={(['won', 'lost', 'open'] as Seg[]).map(k => ({
            key: k,
            label: SEG_LABEL[k],
            value: revenue[k],
            display: moneyShort(revenue[k]),
            color: SEG_COLOR[k],
            sub: k === 'won' ? `of ${moneyShort(quotedTotal)} quoted` : undefined,
          }))}
          center={{ label: 'WON', display: moneyShort(revenue.won), color: SEG_COLOR.won, sub: `of ${moneyShort(quotedTotal)} quoted` }}
          ariaLabel={`Pipeline revenue: won ${moneyShort(revenue.won)}, lost ${moneyShort(revenue.lost)}, on the table ${moneyShort(revenue.open)}`}
        />

        {/* Leads ring: the same split by count. Rests on WON. */}
        <RingStat
          idPrefix="lead"
          caption="LEADS"
          segments={(['won', 'lost', 'open'] as Seg[]).map(k => ({
            key: k,
            label: SEG_LABEL[k],
            value: counts[k],
            display: String(counts[k]),
            color: SEG_COLOR[k],
            sub: k === 'won' ? `${t.winRate}% win rate` : undefined,
          }))}
          center={{ label: 'WON', display: String(counts.won), color: SEG_COLOR.won, sub: `${t.winRate}% win rate` }}
          ariaLabel={`Pipeline leads: won ${counts.won}, lost ${counts.lost}, on the table ${counts.open}`}
        />
      </div>

      <div style={{ textAlign: 'center', marginTop: 12 }}>
        {/* Standalone display stat: Geist 300 pnum */}
        <span style={{ fontSize: 18, ...NUM_DISPLAY }}>
          {avgJob ? moneyShort(avgJob) : '$0'}
        </span>
        <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 6, fontFamily: FONT_BODY }}>AVG JOB</span>
      </div>
    </Card>
  );
}
