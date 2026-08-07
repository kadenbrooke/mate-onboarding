import { Card } from '../Card';
import { moneyShort } from '@/lib/metrics/format';
import { ringSegments } from '@/lib/metrics/ring';
import type { MoneyTotals } from '@/lib/metrics/money';
import {
  brandVar, FREE_GREEN, LOST_BROWN, CARD_MUTED, CARD_TRACK,
  NUM_DISPLAY, NUM_TABLE, FONT_NUM, FONT_BODY,
} from '@/lib/theme';

// Money zone -- QuickBooks Online financials on one card, read-only.
//
// REVENUE · THIS MONTH is the card's single headline, centered at the top. Two
// rings sit beneath it, each styled like the leadflow SourceDonut: a ring
// BESIDE a persistent labeled legend, so every segment's value is readable at a
// glance -- no tapping. (The founder prefers this always-visible breakdown to a
// tap-to-reveal center-swap.)
//
//   Ring 1  EXPENSES + PROFIT = revenue   -- a real equation (the two segments
//           sum to the headline revenue). Center rests on PROFIT, the takeaway.
//   Ring 2  COLLECTED  vs  OUTSTANDING    -- a comparative gauge, NOT an
//           equation: collected is this month's cash, outstanding is the
//           all-time AR balance, so they do not form a total. Center rests on
//           COLLECTED and never shows a sum of the two.
//
// Read-only by construction: the pull only ever GETs from QBO. This card never
// writes anything back.

// SourceDonut geometry, so these rings read as siblings of the leadflow donut.
const R = 40;
const GAP_DEG = 2;
const CIRC = 2 * Math.PI * R;

export function MoneyZone({ money, showLabel = true }: {
  money: MoneyTotals | null;
  showLabel?: boolean;
}) {
  const label = showLabel ? 'REVENUE' : undefined;

  if (money == null) {
    return (
      <Card label={label} themeKey="money">
        <div style={{ color: CARD_MUTED, fontSize: 12, marginTop: 10, fontFamily: FONT_BODY }}>
          turns on when your QuickBooks is connected
        </div>
      </Card>
    );
  }

  const hasExpenses = money.expenses_cents > 0;
  const profitColor = money.profit_cents >= 0 ? FREE_GREEN : LOST_BROWN;
  const invoiceSub = money.invoices_outstanding > 0
    ? `${money.invoices_outstanding} ${money.invoices_outstanding === 1 ? 'invoice' : 'invoices'}`
    : undefined;

  return (
    <Card label={label} themeKey="money">
      {/* Single headline: revenue for the period, centered above both rings. */}
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <div data-testid="money-revenue" style={{ fontSize: 30, ...NUM_DISPLAY, color: brandVar, lineHeight: 1.1 }}>
          {moneyShort(money.revenue_cents)}
        </div>
        <div style={{ fontSize: 10, letterSpacing: 1.2, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>
          REVENUE &middot; THIS MONTH
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap',
        gap: 20, marginTop: 14,
      }}>
        {/* Ring 1: expenses + profit = revenue (still a genuine sum). Center
            rests on PROFIT; both parts are spelled out in the legend. */}
        {hasExpenses && (
          <DonutStat
            idPrefix="money"
            centerTestId="money-pl-center"
            // Profit arc clamped at 0 so expenses>revenue can't make a
            // negative-length (NaN-ish) arc; the signed profit still shows in
            // the center + legend.
            arcs={[
              { key: 'expenses', value: money.expenses_cents, color: LOST_BROWN },
              { key: 'profit', value: Math.max(0, money.profit_cents), color: FREE_GREEN },
            ]}
            center={{ value: money.profit_cents, color: profitColor, label: 'PROFIT' }}
            legend={[
              { testId: 'money-expenses', label: 'EXPENSES', value: moneyShort(money.expenses_cents), color: LOST_BROWN },
              { testId: 'money-profit', label: 'PROFIT', value: moneyShort(money.profit_cents), color: profitColor },
            ]}
            ariaLabel={`Profit ${moneyShort(money.profit_cents)} and expenses ${moneyShort(money.expenses_cents)}, which sum to revenue ${moneyShort(money.revenue_cents)}`}
          />
        )}

        {/* Ring 2: collected vs outstanding -- comparative gauge, no sum. */}
        <DonutStat
          idPrefix="money-cash"
          centerTestId="money-cash-center"
          arcs={[
            { key: 'collected', value: money.collected_cents, color: FREE_GREEN },
            { key: 'ar', value: money.ar_cents, color: brandVar },
          ]}
          center={{ value: money.collected_cents, color: FREE_GREEN, label: 'COLLECTED' }}
          legend={[
            { testId: 'money-collected', label: 'COLLECTED', value: moneyShort(money.collected_cents), color: FREE_GREEN },
            { testId: 'money-ar', label: 'OUTSTANDING', value: moneyShort(money.ar_cents), color: brandVar, sub: invoiceSub },
          ]}
          ariaLabel={`Collected this month ${moneyShort(money.collected_cents)} versus outstanding receivables ${moneyShort(money.ar_cents)}`}
        />
      </div>

      <div style={{ marginTop: 12, fontSize: 9.5, letterSpacing: 0.5, color: CARD_MUTED, fontFamily: FONT_BODY, textAlign: 'center' }}>
        {periodLabel(money)} &middot; from QuickBooks &middot; updated {money.date_pulled}
      </div>
    </Card>
  );
}

type Arc = { key: string; value: number; color: string };
type CenterSpec = { value: number; color: string; label: string };
type LegendSpec = { testId: string; label: string; value: string; color: string; sub?: string };

/**
 * A segmented ring beside an always-visible labeled legend, mirroring the
 * leadflow SourceDonut. Every segment's value is spelled out in the legend
 * (swatch + label + value) with no interaction required; the ring center holds
 * one resting stat.
 *
 * The center renders a single provided value -- it never sums the segments, so
 * a ring whose parts are different-period measures (collected vs outstanding)
 * stays a comparative gauge, not a false equation.
 *
 * Zero-value / all-zero inputs degrade gracefully: `ringSegments` yields
 * zero-length dashes (no NaN, no negative arcs) and the bare track circle shows
 * through as a muted empty state.
 */
function DonutStat({ idPrefix, centerTestId, arcs, center, legend, ariaLabel }: {
  idPrefix: string;
  centerTestId: string;
  arcs: Arc[];
  center: CenterSpec;
  legend: LegendSpec[];
  ariaLabel: string;
}) {
  const segs = ringSegments(arcs.map(a => ({ key: a.key, value: a.value })), R, GAP_DEG);
  const colorOf = (key: string) => arcs.find(a => a.key === key)?.color ?? brandVar;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width={104} height={104} viewBox="0 0 100 100" style={{ flexShrink: 0 }} role="img" aria-label={ariaLabel}>
        <g transform="translate(50,50) rotate(-90)">
          <circle r={R} fill="none" stroke={CARD_TRACK} strokeWidth={12} />
          {segs.map(s => (
            <circle
              key={s.key}
              data-testid={`${idPrefix}-seg-${s.key}`}
              r={R}
              fill="none"
              stroke={colorOf(s.key)}
              strokeWidth={12}
              strokeDasharray={`${s.dash} ${CIRC}`}
              strokeDashoffset={s.offset}
            />
          ))}
        </g>
        {/* Center: Geist 300 pnum standalone display stat, like SourceDonut. */}
        <text
          data-testid={centerTestId}
          x={50}
          y={47}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={19}
          fontWeight={300}
          fontFamily={FONT_NUM}
          fill={center.color}
        >
          {moneyShort(center.value)}
        </text>
        <text
          x={50}
          y={62}
          textAnchor="middle"
          fontSize={8}
          letterSpacing={1}
          fontFamily={FONT_BODY}
          fill={center.color}
        >
          {center.label}
        </text>
      </svg>

      {/* Persistent legend: swatch + label + value, all segments visible. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {legend.map(l => (
          <div key={l.testId} data-testid={l.testId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
            <div style={{ width: 9, height: 9, borderRadius: 3, background: l.color, flexShrink: 0 }} />
            <span style={{ color: CARD_MUTED, fontFamily: FONT_BODY }}>
              {l.label}
              {' '}
              <span style={{ ...NUM_TABLE, color: l.color }}>{l.value}</span>
              {l.sub && (
                <>
                  {' '}
                  <span style={{ fontSize: 8.5, color: CARD_MUTED }}>&middot; {l.sub}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "July 2026" from the period key/range, falling back to the raw period. */
function periodLabel(money: MoneyTotals): string {
  const src = money.period_start ?? (money.period ? `${money.period}-01` : null);
  if (src) {
    const d = new Date(src);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
  }
  return money.period || 'This period';
}
