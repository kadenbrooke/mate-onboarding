'use client';
import { useState } from 'react';
import { Card } from '../Card';
import { moneyShort } from '@/lib/metrics/format';
import { ringSegments } from '@/lib/metrics/ring';
import type { MoneyTotals } from '@/lib/metrics/money';
import {
  brandVar, FREE_GREEN, LOST_BROWN, CARD_MUTED, CARD_INSET, CARD_HAIRLINE,
  CARD_TRACK, NUM_DISPLAY, FONT_NUM, FONT_BODY,
} from '@/lib/theme';

// Money zone -- QuickBooks Online financials on one card, read-only.
//
// Headline is REVENUE this period, rendered inside a ring that splits it into
// its two parts: EXPENSES + PROFIT. The two segments sum to revenue, so the
// ring visibly "adds up" -- the point the flat stat list missed (a stack of
// numbers that don't obviously reconcile). Tapping a segment swaps the center
// metric (the locked ring center-swap interaction, same as the Pipeline
// TwinRings); the resting center is always REVENUE.
//
// Cash-flow stats sit below the ring: money COLLECTED this month and
// OUTSTANDING receivables -- the two numbers a paving-crew owner acts on.
// Read-only by construction: the pull only ever GETs from QBO. This card never
// writes anything back.

const R = 48;
const GAP_DEG = 3;
const CIRC = 2 * Math.PI * R;

type Focus = 'revenue' | 'expenses' | 'profit';

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

  return (
    <Card label={label} themeKey="money">
      {hasExpenses
        ? <RevenueRing money={money} />
        : <RevenueHero revenueCents={money.revenue_cents} />}

      {/* Cash-flow stats: what came in, what's still owed. */}
      <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
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
      </div>

      <div style={{ marginTop: 10, fontSize: 9.5, letterSpacing: 0.5, color: CARD_MUTED, fontFamily: FONT_BODY }}>
        {periodLabel(money)} &middot; from QuickBooks &middot; updated {money.date_pulled}
      </div>
    </Card>
  );
}

/**
 * Revenue split into Expenses + Profit as a two-segment ring, with the locked
 * center-swap interaction. Resting center is REVENUE; hovering/tapping a
 * segment (or its legend row) swaps the center to that part, leaving resets to
 * revenue. Negative profit is clamped out of the arc (full expense ring) but
 * still shown, signed, in the legend -- never a NaN/negative-length arc.
 */
function RevenueRing({ money }: { money: MoneyTotals }) {
  const [focus, setFocus] = useState<Focus>('revenue');

  const profitColor = money.profit_cents >= 0 ? FREE_GREEN : LOST_BROWN;
  const profitForArc = Math.max(0, money.profit_cents); // negative profit -> no profit arc

  const segs = ringSegments(
    [
      { key: 'expenses', value: money.expenses_cents },
      { key: 'profit', value: profitForArc },
    ],
    R,
    GAP_DEG,
  );

  const segColor = (key: string) => (key === 'profit' ? FREE_GREEN : LOST_BROWN);

  const centerValue =
    focus === 'expenses' ? money.expenses_cents
    : focus === 'profit' ? money.profit_cents
    : money.revenue_cents;
  const centerColor =
    focus === 'expenses' ? LOST_BROWN
    : focus === 'profit' ? profitColor
    : brandVar;
  const centerSub =
    focus === 'expenses' ? 'EXPENSES'
    : focus === 'profit' ? 'PROFIT'
    : 'REVENUE · THIS MONTH';

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <svg
        viewBox="0 0 120 120"
        style={{ width: 150, maxWidth: '70%' }}
        role="img"
        aria-label={`Revenue ${moneyShort(money.revenue_cents)}: expenses ${moneyShort(money.expenses_cents)} plus profit ${moneyShort(money.profit_cents)}`}
        onMouseLeave={() => setFocus('revenue')}
      >
        <g transform="translate(60,60) rotate(-90)">
          <circle r={R} fill="none" stroke={CARD_TRACK} strokeWidth={11} />
          {segs.map(s => (
            <circle
              key={s.key}
              data-testid={`money-seg-${s.key}`}
              r={R}
              fill="none"
              stroke={segColor(s.key)}
              strokeWidth={focus === s.key ? 13 : 11}
              strokeLinecap="round"
              strokeDasharray={`${s.dash} ${CIRC}`}
              strokeDashoffset={s.offset}
              style={{ cursor: 'pointer' }}
              onClick={() => setFocus(f => (f === s.key ? 'revenue' : (s.key as Focus)))}
              onMouseEnter={() => setFocus(s.key as Focus)}
            />
          ))}
        </g>
        {/* Center: Geist 300 pnum standalone display stat, mirrors TwinRings. */}
        <text
          data-testid="money-revenue"
          x="60"
          y="57"
          textAnchor="middle"
          fill={centerColor}
          fontSize="20"
          fontWeight="300"
          fontFamily={FONT_NUM}
        >
          {moneyShort(centerValue)}
        </text>
        <text x="60" y="70" textAnchor="middle" fill={CARD_MUTED} fontSize="6.5" letterSpacing="0.5" fontFamily={FONT_BODY}>
          {centerSub}
        </text>
      </svg>

      {/* Legend doubles as a large tap target for the swap on mobile. */}
      <div style={{ display: 'flex', gap: 14 }}>
        <LegendChip
          testId="money-expenses"
          label="EXPENSES"
          value={moneyShort(money.expenses_cents)}
          color={LOST_BROWN}
          active={focus === 'expenses'}
          onFocus={() => setFocus('expenses')}
          onBlurToRest={() => setFocus('revenue')}
          onToggle={() => setFocus(f => (f === 'expenses' ? 'revenue' : 'expenses'))}
        />
        <LegendChip
          testId="money-profit"
          label="PROFIT"
          value={moneyShort(money.profit_cents)}
          color={profitColor}
          active={focus === 'profit'}
          onFocus={() => setFocus('profit')}
          onBlurToRest={() => setFocus('revenue')}
          onToggle={() => setFocus(f => (f === 'profit' ? 'revenue' : 'profit'))}
        />
      </div>
    </div>
  );
}

/** No expenses pulled: a plain revenue hero, no ring to split (and nothing
 *  broken to look at). Keeps the money-revenue hook the tests read. */
function RevenueHero({ revenueCents }: { revenueCents: number }) {
  return (
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span data-testid="money-revenue" style={{ fontSize: 30, ...NUM_DISPLAY, color: brandVar }}>
        {moneyShort(revenueCents)}
      </span>
      <span style={{ fontSize: 10, letterSpacing: 1.2, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>
        REVENUE &middot; THIS MONTH
      </span>
    </div>
  );
}

function LegendChip({ testId, label, value, color, active, onFocus, onBlurToRest, onToggle }: {
  testId: string;
  label: string;
  value: string;
  color: string;
  active: boolean;
  onFocus: () => void;
  onBlurToRest: () => void;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onToggle}
      onMouseEnter={onFocus}
      onMouseLeave={onBlurToRest}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
        padding: '5px 9px', borderRadius: 8, background: CARD_INSET,
        border: `1px solid ${active ? color : CARD_HAIRLINE}`,
        font: 'inherit', color: 'inherit',
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 10, letterSpacing: 1, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, ...NUM_DISPLAY, color }}>{value}</span>
    </button>
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
