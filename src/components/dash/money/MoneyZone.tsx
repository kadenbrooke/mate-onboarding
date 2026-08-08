import { Card } from '../Card';
import { moneyShort } from '@/lib/metrics/format';
import { RingStat } from '../RingStat';
import type { MoneyTotals } from '@/lib/metrics/money';
import { brandVar, FREE_GREEN, LOST_BROWN, CARD_MUTED, NUM_DISPLAY, FONT_BODY } from '@/lib/theme';

// Money zone -- QuickBooks Online financials on one card, read-only.
//
// REVENUE · THIS MONTH is the card's single headline, centered at the top. Two
// rings sit beneath it, both rendered through the shared RingStat (ring +
// always-visible labeled legend + hover/tap center-swap):
//
//   Ring 1  EXPENSES + PROFIT = revenue   -- a real equation (the two segments
//           sum to the headline revenue). Center rests on PROFIT, the takeaway.
//   Ring 2  COLLECTED  vs  OUTSTANDING    -- a comparative gauge, NOT an
//           equation: collected is this month's cash, outstanding is the
//           all-time AR balance, so they do not form a total. Center rests on
//           COLLECTED. RingStat's center only ever shows one real value, so it
//           can never render collected+ar as a sum.
//
// Read-only by construction: the pull only ever GETs from QBO. This card never
// writes anything back.

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
        {/* Ring 1: expenses + profit = revenue (a genuine sum). Center rests on
            PROFIT; both parts are spelled out in the legend. Profit arc clamped
            at 0 so expenses>revenue can't make a negative-length arc -- the
            signed profit still shows in the center + legend. */}
        {hasExpenses && (
          <RingStat
            idPrefix="money-pl"
            segments={[
              { key: 'expenses', label: 'EXPENSES', value: money.expenses_cents, display: moneyShort(money.expenses_cents), color: LOST_BROWN },
              { key: 'profit', label: 'PROFIT', value: money.profit_cents, display: moneyShort(money.profit_cents), color: profitColor, arcValue: Math.max(0, money.profit_cents) },
            ]}
            center={{ label: 'PROFIT', display: moneyShort(money.profit_cents), color: profitColor }}
            ariaLabel={`Profit ${moneyShort(money.profit_cents)} and expenses ${moneyShort(money.expenses_cents)}, which sum to revenue ${moneyShort(money.revenue_cents)}`}
          />
        )}

        {/* Ring 2: collected vs outstanding -- comparative gauge, no sum. */}
        <RingStat
          idPrefix="money-cash"
          segments={[
            { key: 'collected', label: 'COLLECTED', value: money.collected_cents, display: moneyShort(money.collected_cents), color: FREE_GREEN },
            { key: 'ar', label: 'OUTSTANDING', value: money.ar_cents, display: moneyShort(money.ar_cents), color: brandVar, sub: invoiceSub, legendSub: invoiceSub },
          ]}
          center={{ label: 'COLLECTED', display: moneyShort(money.collected_cents), color: FREE_GREEN }}
          ariaLabel={`Collected this month ${moneyShort(money.collected_cents)} versus outstanding receivables ${moneyShort(money.ar_cents)}`}
        />
      </div>

      <div style={{ marginTop: 12, fontSize: 9.5, letterSpacing: 0.5, color: CARD_MUTED, fontFamily: FONT_BODY, textAlign: 'center' }}>
        {periodLabel(money)} &middot; from QuickBooks &middot; updated {money.date_pulled}
      </div>
    </Card>
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
