'use client';
import { Card } from '../Card';
import { moneyShort } from '@/lib/metrics/format';
import type { MoneyTotals } from '@/lib/metrics/money';
import {
  brandVar, FREE_GREEN, LOST_BROWN, CARD_MUTED, CARD_INSET, CARD_HAIRLINE,
  NUM_DISPLAY, FONT_BODY, FONT_HEAD,
} from '@/lib/theme';

// Money zone -- QuickBooks Online financials on one card, read-only.
//
// Headline is REVENUE this period (what the business brought in). Supporting
// stats: money COLLECTED this month, and OUTSTANDING receivables (invoices not
// yet paid) -- the two numbers a paving-crew owner actually acts on. Profit and
// expenses sit in the secondary row when present. Same visual system as the Ad
// Performance zone: a hero number, a stat strip, a last-updated footer.
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

  return (
    <Card label={label} themeKey="money">
      {/* Hero: revenue for the period. */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span data-testid="money-revenue" style={{ fontSize: 30, ...NUM_DISPLAY, color: brandVar }}>
          {moneyShort(money.revenue_cents)}
        </span>
        <span style={{ fontSize: 10, letterSpacing: 1.2, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>
          REVENUE &middot; THIS MONTH
        </span>
      </div>

      {/* Primary stat strip: collected + outstanding. */}
      <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
        <StatRow
          label="COLLECTED THIS MONTH"
          value={moneyShort(money.collected_cents)}
          color={FREE_GREEN}
          testId="money-collected"
        />
        <StatRow
          label="OUTSTANDING"
          value={moneyShort(money.ar_cents)}
          sub={money.invoices_outstanding > 0
            ? `${money.invoices_outstanding} ${money.invoices_outstanding === 1 ? 'invoice' : 'invoices'}`
            : undefined}
          color={brandVar}
          testId="money-ar"
        />
        {hasExpenses && (
          <>
            <StatRow
              label="EXPENSES"
              value={moneyShort(money.expenses_cents)}
              color={LOST_BROWN}
              testId="money-expenses"
            />
            <StatRow
              label="PROFIT"
              value={moneyShort(money.profit_cents)}
              color={profitColor}
              testId="money-profit"
            />
          </>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 9.5, letterSpacing: 0.5, color: CARD_MUTED, fontFamily: FONT_BODY }}>
        {periodLabel(money)} &middot; from QuickBooks &middot; updated {money.date_pulled}
      </div>
    </Card>
  );
}

function StatRow({ label, value, sub, color, testId }: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'baseline',
        padding: '9px 11px', borderRadius: 10, background: CARD_INSET,
        border: `1px solid ${CARD_HAIRLINE}`,
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: 1.2, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
        {sub && <span style={{ fontSize: 9, color: CARD_MUTED, fontFamily: FONT_BODY }}>{sub}</span>}
        <span style={{ fontSize: 15, ...NUM_DISPLAY, color: color ?? 'var(--card-fg, #141414)' }}>{value}</span>
      </span>
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
