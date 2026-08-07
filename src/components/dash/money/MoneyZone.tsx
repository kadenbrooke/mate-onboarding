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
// Two rings, laid out like the Pipeline TwinRings:
//
//   Ring 1  REVENUE = EXPENSES + PROFIT   -- a real equation. The two segments
//           sum to revenue, so the ring visibly reconciles (the point the flat
//           stat list missed). Resting center is REVENUE.
//   Ring 2  COLLECTED  vs  OUTSTANDING    -- a comparative gauge, NOT an
//           equation: collected is this month's cash, outstanding is the
//           all-time AR balance, so they do not form a total. The center
//           therefore only ever shows ONE real segment value -- never a sum.
//
// Both rings carry the same locked center-swap interaction (SwapRing): a
// resting center metric, and hovering/tapping a segment (or its legend chip)
// swaps the center to that segment; leaving / re-tapping returns to rest.
//
// Read-only by construction: the pull only ever GETs from QBO. This card never
// writes anything back.

const R = 48;
const GAP_DEG = 3;
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
      <div style={{
        display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap',
        gap: 16, marginTop: 8,
      }}>
        {/* Ring 1: revenue = expenses + profit (a genuine sum). */}
        {hasExpenses ? (
          <SwapRing
            idPrefix="money"
            centerTestId="money-revenue"
            restKey="revenue"
            // Profit arc clamped at 0 so expenses>revenue can't make a
            // negative-length (NaN-ish) arc; the signed profit still shows in
            // the center + legend.
            arcs={[
              { key: 'expenses', value: money.expenses_cents, color: LOST_BROWN },
              { key: 'profit', value: Math.max(0, money.profit_cents), color: FREE_GREEN },
            ]}
            centers={{
              revenue: { value: money.revenue_cents, color: brandVar, label: 'REVENUE · THIS MONTH' },
              expenses: { value: money.expenses_cents, color: LOST_BROWN, label: 'EXPENSES' },
              profit: { value: money.profit_cents, color: profitColor, label: 'PROFIT' },
            }}
            legend={[
              { focusKey: 'expenses', testId: 'money-expenses', label: 'EXPENSES', value: moneyShort(money.expenses_cents), color: LOST_BROWN },
              { focusKey: 'profit', testId: 'money-profit', label: 'PROFIT', value: moneyShort(money.profit_cents), color: profitColor },
            ]}
            ariaLabel={`Revenue ${moneyShort(money.revenue_cents)}: expenses ${moneyShort(money.expenses_cents)} plus profit ${moneyShort(money.profit_cents)}`}
          />
        ) : (
          <RevenueHero revenueCents={money.revenue_cents} />
        )}

        {/* Ring 2: collected vs outstanding -- comparative gauge, no sum. */}
        <SwapRing
          idPrefix="money-cash"
          centerTestId="money-cash-center"
          restKey="collected"
          arcs={[
            { key: 'collected', value: money.collected_cents, color: FREE_GREEN },
            { key: 'ar', value: money.ar_cents, color: brandVar },
          ]}
          centers={{
            collected: { value: money.collected_cents, color: FREE_GREEN, label: 'COLLECTED · THIS MONTH' },
            ar: { value: money.ar_cents, color: brandVar, label: 'OUTSTANDING', sub: invoiceSub },
          }}
          legend={[
            { focusKey: 'collected', testId: 'money-collected', label: 'COLLECTED', value: moneyShort(money.collected_cents), color: FREE_GREEN },
            { focusKey: 'ar', testId: 'money-ar', label: 'OUTSTANDING', value: moneyShort(money.ar_cents), color: brandVar, sub: invoiceSub },
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
type CenterSpec = { value: number; color: string; label: string; sub?: string };
type LegendSpec = { focusKey: string; testId: string; label: string; value: string; color: string; sub?: string };

/**
 * Segmented ring with the locked center-swap interaction (mirrors the Pipeline
 * TwinRings): resting center = `restKey`; hovering/tapping a segment or its
 * legend chip swaps the center to that segment; leaving / re-tapping the active
 * segment returns to rest.
 *
 * The center only ever renders a value from `centers` -- one real number at a
 * time. It never computes or displays a sum of segments, so a ring whose parts
 * are different-period measures (collected vs outstanding) stays a comparative
 * gauge, not a false equation.
 *
 * Zero-value / all-zero inputs degrade gracefully: `ringSegments` yields
 * zero-length dashes (no NaN, no negative arcs) and the bare track circle shows
 * through as a muted empty state.
 */
function SwapRing({ idPrefix, centerTestId, arcs, restKey, centers, legend, ariaLabel }: {
  idPrefix: string;
  centerTestId: string;
  arcs: Arc[];
  restKey: string;
  centers: Record<string, CenterSpec>;
  legend: LegendSpec[];
  ariaLabel: string;
}) {
  const [focus, setFocus] = useState<string>(restKey);
  const active = centers[focus] ?? centers[restKey];

  const segs = ringSegments(arcs.map(a => ({ key: a.key, value: a.value })), R, GAP_DEG);
  const colorOf = (key: string) => arcs.find(a => a.key === key)?.color ?? brandVar;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <svg
        viewBox="0 0 120 120"
        style={{ width: 138, maxWidth: '100%' }}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setFocus(restKey)}
      >
        <g transform="translate(60,60) rotate(-90)">
          <circle r={R} fill="none" stroke={CARD_TRACK} strokeWidth={11} />
          {segs.map(s => (
            <circle
              key={s.key}
              data-testid={`${idPrefix}-seg-${s.key}`}
              r={R}
              fill="none"
              stroke={colorOf(s.key)}
              strokeWidth={focus === s.key ? 13 : 11}
              strokeLinecap="round"
              strokeDasharray={`${s.dash} ${CIRC}`}
              strokeDashoffset={s.offset}
              style={{ cursor: 'pointer' }}
              onClick={() => setFocus(f => (f === s.key ? restKey : s.key))}
              onMouseEnter={() => setFocus(s.key)}
            />
          ))}
        </g>
        {/* Center: Geist 300 pnum standalone display stat, mirrors TwinRings. */}
        <text
          data-testid={centerTestId}
          x="60"
          y="57"
          textAnchor="middle"
          fill={active.color}
          fontSize="20"
          fontWeight="300"
          fontFamily={FONT_NUM}
        >
          {moneyShort(active.value)}
        </text>
        <text x="60" y="70" textAnchor="middle" fill={CARD_MUTED} fontSize="6.5" letterSpacing="0.5" fontFamily={FONT_BODY}>
          {active.sub ?? active.label}
        </text>
      </svg>

      {/* Legend chips double as large mobile tap targets for the swap. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 168 }}>
        {legend.map(l => (
          <LegendChip
            key={l.focusKey}
            testId={l.testId}
            label={l.label}
            value={l.value}
            sub={l.sub}
            color={l.color}
            active={focus === l.focusKey}
            onFocus={() => setFocus(l.focusKey)}
            onBlurToRest={() => setFocus(restKey)}
            onToggle={() => setFocus(f => (f === l.focusKey ? restKey : l.focusKey))}
          />
        ))}
      </div>
    </div>
  );
}

/** No expenses pulled: a plain revenue hero, no ring to split (and nothing
 *  broken to look at). Keeps the money-revenue hook the tests read. */
function RevenueHero({ revenueCents }: { revenueCents: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 138 }}>
      <span data-testid="money-revenue" style={{ fontSize: 34, ...NUM_DISPLAY, color: brandVar }}>
        {moneyShort(revenueCents)}
      </span>
      <span style={{ fontSize: 9, letterSpacing: 1.2, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600, marginTop: 2 }}>
        REVENUE &middot; THIS MONTH
      </span>
    </div>
  );
}

function LegendChip({ testId, label, value, sub, color, active, onFocus, onBlurToRest, onToggle }: {
  testId: string;
  label: string;
  value: string;
  sub?: string;
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
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 7,
        cursor: 'pointer', width: '100%',
        padding: '6px 9px', borderRadius: 8, background: CARD_INSET,
        border: `1px solid ${active ? color : CARD_HAIRLINE}`,
        font: 'inherit', color: 'inherit', textAlign: 'left',
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 9.5, letterSpacing: 1, color: CARD_MUTED, fontFamily: FONT_BODY, fontWeight: 600 }}>
          {label}
        </span>
        {sub && <span style={{ fontSize: 8.5, color: CARD_MUTED, fontFamily: FONT_BODY }}>{sub}</span>}
      </span>
      <span style={{ fontSize: 13, ...NUM_DISPLAY, color }}>{value}</span>
    </button>
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
