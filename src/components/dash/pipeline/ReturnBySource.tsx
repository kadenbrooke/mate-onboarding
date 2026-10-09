import Link from 'next/link';
import type { ReturnSummary, SourceReturn } from '@/lib/metrics/revenue';
import type { ClientReturnSummary, ClientSourceReturn } from '@/lib/metrics/revenueVisibility';
import { SOURCE_LABELS } from '@/lib/metrics/colors';
import { moneyShort } from '@/lib/metrics/format';
import { PARTNER_CHANNEL_SOURCES } from '@/lib/metrics/partnerChannels';
import { Card } from '../Card';
import {
  CARD_CHIP, CARD_FAINT, CARD_FG, CARD_HAIRLINE, CARD_INSET, CARD_MUTED, FONT_BODY, FREE_GREEN, NUM_DISPLAY, brandVar,
} from '@/lib/theme';

// What each lead source actually returned, from the won / lost, sold price and
// cash collected the client enters per lead (migration 0021), plus the
// partner revenue-share basis. The math lives in revenue.ts; which sources are
// partner channels lives in partnerChannels.ts.

const EXTRA_LABELS: Record<string, string> = { typed: 'Typed in', lead_snapshot: 'Lead snapshot', self_sourced: 'We found it (door knock / cold call)' };
const label = (source: string) => SOURCE_LABELS[source] ?? EXTRA_LABELS[source] ?? source.replaceAll('_', ' ');
const pct = (bps: number) => `${bps / 100}%`;
// Every source the config counts as a partner channel, whether or not it has
// leads yet, so the footnote states the rule rather than today's data.
const PARTNER_NAMES = Object.entries(PARTNER_CHANNEL_SOURCES)
  .filter(([, owner]) => owner === 'partner').map(([source]) => label(source)).join(', ');

function SourceRow({ r }: { r: SourceReturn | ClientSourceReturn }) {
  return (
    <div data-testid={`return-${r.source}`} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
      padding: '10px 0', borderTop: `1px solid ${CARD_HAIRLINE}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: CARD_FG }}>{label(r.source)}</span>
          {r.owner === 'partner' && (
            <span style={{ fontSize: 10, letterSpacing: 1, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: CARD_CHIP, color: CARD_MUTED }}>
              PARTNER
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: CARD_MUTED }}>
          {r.leads} {r.leads === 1 ? 'lead' : 'leads'} · {r.won} won{r.winRate != null ? ` (${r.winRate}%)` : ''}
          {r.job_value_cents > 0 ? ` · ${moneyShort(r.job_value_cents)} sold` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ ...NUM_DISPLAY, fontSize: 18, color: r.collected_cents > 0 ? FREE_GREEN : CARD_FAINT }}>
          {moneyShort(r.collected_cents)}
        </div>
        <div style={{ fontSize: 11, color: CARD_FAINT }}>collected</div>
      </div>
    </div>
  );
}

export function ReturnBySource({ summary, sessionId, showLabel = true }: {
  summary: ReturnSummary | ClientReturnSummary; sessionId: string; showLabel?: boolean;
}) {
  const { rows, partner, meta } = summary;

  return (
    <Card label={showLabel ? 'RETURN BY SOURCE' : undefined} themeKey="return-by-source">
      <div style={{ fontFamily: FONT_BODY, marginTop: 6 }}>
        {!summary.hasOutcomes && (
          <div style={{ fontSize: 13, color: CARD_MUTED, paddingBottom: 8 }}>
            Mark jobs won or lost, with what they sold for and the cash collected, to see what each lead source brings back.{' '}
            <Link href={`/dash/${sessionId}/pipeline`} style={{ color: brandVar, fontWeight: 600 }}>Open the pipeline</Link>
          </div>
        )}

        {rows.length === 0
          ? <div style={{ fontSize: 13, color: CARD_FAINT }}>No leads yet.</div>
          : rows.map(r => <SourceRow key={r.source} r={r} />)}

        {meta.spend30dCents != null && (
          <div data-testid="return-meta-30d" style={{ fontSize: 12, color: CARD_MUTED, paddingTop: 10, borderTop: `1px solid ${CARD_HAIRLINE}` }}>
            Meta ads, last 30 days: {moneyShort(meta.spend30dCents)} spent, {moneyShort(meta.collected30dCents)} collected from Meta leads
            {meta.returnPerDollar != null ? ` (${meta.returnPerDollar.toFixed(1)}x)` : ''}.
          </div>
        )}

        {partner && <div data-testid="return-partner-basis" style={{ marginTop: 10, padding: 12, borderRadius: 12, background: CARD_INSET }}>
          <div style={{ fontSize: 11, letterSpacing: 2, fontWeight: 600, color: CARD_MUTED }}>
            {pct(partner.shareBps)} BASIS · ESTIMATE
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <span style={{ ...NUM_DISPLAY, fontSize: 22, color: CARD_FG }}>{moneyShort(partner.shareCents)}</span>
            <span style={{ fontSize: 12, color: CARD_MUTED }}>
              {pct(partner.shareBps)} of {moneyShort(partner.collectedCents)} collected from partner channels
            </span>
          </div>
          <div style={{ fontSize: 11, color: CARD_FAINT, marginTop: 6 }}>
            Pending the signed agreement. Partner channels counted: {PARTNER_NAMES}. Cash within 24 months of first contact.
            Does not yet exclude customers who had a quote, job or invoice in the prior 12 months.
          </div>
        </div>}
      </div>
    </Card>
  );
}
