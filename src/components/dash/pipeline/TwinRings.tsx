import { pipelineTotals, PIPELINE_STATUSES, type Lead, type LeadStatus } from '@/lib/metrics/leads';
import { Card } from '../Card';
import { RingStat } from '../RingStat';
import { STAGE_COLOR, STAGE_LABEL, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';
import { moneyShort } from '@/lib/metrics/format';

// Two rings over the same four pipeline stages: one by quote value, one by
// lead count. Both rest on SERVICED (money actually collected), the way they
// used to rest on WON, with the remaining three stages showing what is still
// in flight rather than a dead-end "lost" bucket.

export function TwinRings({ leads, showLabel = true }: { leads: Lead[]; showLabel?: boolean }) {
  const t = pipelineTotals(leads);
  const avgJob = t.counts.serviced ? Math.round(t.cents.serviced / t.counts.serviced) : 0;
  const stages = PIPELINE_STATUSES as readonly LeadStatus[];
  // Center subs must fit inside the donut hole (~14 chars at this size);
  // longer strings render across the arcs.
  const engaged = t.counts.booked + t.counts.quoted + t.counts.serviced;
  const rateSub = `of ${engaged} engaged`;
  const revSub = `of ${moneyShort(t.totalCents)}`;

  return (
    <Card label={showLabel ? 'THE PIPELINE' : undefined} themeKey="the-pipeline">
      <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
        {/* Revenue ring: quote value at each stage. Rests on SERVICED. */}
        <RingStat
          idPrefix="rev"
          caption="REVENUE"
          segments={stages.map(k => ({
            key: k,
            label: STAGE_LABEL[k],
            value: t.cents[k],
            display: moneyShort(t.cents[k]),
            color: STAGE_COLOR[k],
            sub: k === 'serviced' ? revSub : undefined,
          }))}
          center={{
            label: STAGE_LABEL.serviced,
            display: moneyShort(t.cents.serviced),
            color: STAGE_COLOR.serviced,
            sub: revSub,
          }}
          ariaLabel={stages.map(k => `${STAGE_LABEL[k].toLowerCase()} ${moneyShort(t.cents[k])}`).join(', ')}
        />

        {/* Leads ring: the same split by count. Rests on SERVICED. */}
        <RingStat
          idPrefix="lead"
          caption="LEADS"
          segments={stages.map(k => ({
            key: k,
            label: STAGE_LABEL[k],
            value: t.counts[k],
            display: String(t.counts[k]),
            color: STAGE_COLOR[k],
            sub: k === 'serviced' ? rateSub : undefined,
          }))}
          center={{
            label: STAGE_LABEL.serviced,
            display: String(t.counts.serviced),
            color: STAGE_COLOR.serviced,
            sub: rateSub,
          }}
          ariaLabel={stages.map(k => `${STAGE_LABEL[k].toLowerCase()} ${t.counts[k]}`).join(', ')}
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
