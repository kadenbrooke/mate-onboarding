'use client';
import {
  Wrench, UsersThree, Robot, Warning, Star, Clock, ArrowUpRight, ArrowDownRight,
} from '@phosphor-icons/react';
import { useCountUp } from './useCountUp';
import { FONT_BODY, NUM_DISPLAY } from '@/lib/theme';
import { moneyShort } from '@/lib/metrics/format';
import { AUTO_MATE_AGENT_COUNT } from '@/lib/metrics/crew';
import type { MonthOverview, MonthRevenue } from '@/lib/metrics/monthOverview';

// Sits above the Hero strip: the "CEO glance" zone. A revenue headline plus six
// supporting stats that cover the questions an owner actually asks in the first
// 30 seconds -- how much did the business make, are we busy, how much of the
// crew is working, what needs me, are customers happy.
//
// The revenue headline is the BUSINESS's revenue (QuickBooks when connected).
// The dark Recovered card directly below is AGENT-ATTRIBUTED revenue, which it
// divides by the retainer for the ROI multiple. Two genuinely different numbers,
// each labelled with where it came from; do not collapse them into one.
//
// 2026-08-11 tile swap: CALLS HANDLED -> AGENTS ACTIVE, AVG RESPONSE ->
// NEEDS ATTENTION, RATING -> REVIEWS COLLECTED, COST / LEAD -> HOURS SAVED.
// monthOverview still computes callsHandled and avgResponseSeconds; they are
// simply no longer on the glance card.

function TrendPill({ pct }: { pct: number }) {
  const up = pct >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
      fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
      background: 'rgba(255,255,255,0.22)',
      borderRadius: 99, padding: '3px 8px',
    }}>
      <Arrow size={11} weight="bold" aria-hidden />
      {up ? '+' : ''}{pct}%
    </span>
  );
}

function StatTile({ icon, label, big, sub, trend }: {
  icon: React.ReactNode; label: string; big: React.ReactNode; sub?: string;
  trend?: { pct: number };
}) {
  return (
    <div style={{
      minWidth: 0, background: 'rgba(255,255,255,0.14)', borderRadius: 14,
      padding: '12px 14px',
    }}>
      {/* Short, whole-word labels that WRAP instead of truncating: a
          2-word eyebrow ("NEW LEADS") stays on one line on any screen
          wide enough for the tile itself; anything longer wraps to a
          second line rather than clipping mid-word. */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 10.5,
        letterSpacing: 0.5, fontWeight: 600, fontFamily: FONT_BODY, opacity: 0.85,
        lineHeight: 1.25, minWidth: 0,
      }}>
        <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0, marginTop: 1 }}>{icon}</span>
        <span>{label}</span>
      </div>
      {/* Bottom row: big number lower-left, trend pill lower-right -- not
          the header row, so it never crowds a two-line-wrapped label. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
        <div style={{ fontSize: 24, lineHeight: 1, ...NUM_DISPLAY }}>{big}</div>
        {trend && <TrendPill pct={trend.pct} />}
      </div>
      {sub && (
        <div style={{ fontSize: 10.5, fontFamily: FONT_BODY, marginTop: 4, opacity: 0.75 }}>{sub}</div>
      )}
    </div>
  );
}

function CountedNumber({ value }: { value: number }) {
  const n = useCountUp(value, 900);
  return <>{Math.round(n)}</>;
}

export function MonthOverviewBanner({
  overview, revenue, activeAgents, reviewsCollected, hoursSaved,
}: {
  overview: MonthOverview;
  /** Business revenue for the month: QuickBooks when connected, the
   *  serviced-lead sum (labelled as such) when not. Distinct from the hero
   *  Recovered card, which stays agent-attributed for the ROI math. */
  revenue: MonthRevenue;
  /** Live agents out of AUTO_MATE_AGENT_COUNT. Counted from the client's own
   *  capability rows BEFORE zone gating (see page.tsx), so a locked Operations
   *  zone cannot make the crew look smaller than it is. */
  activeAgents: number;
  /** client_reviews rows for this session. */
  reviewsCollected: number;
  /** Agent-hours saved this week: the metric the retired HOURS SAVED hero card
   *  carried, same calculation (actions x minutes-per-action). */
  hoursSaved: number;
}) {
  return (
    <div style={{
      borderRadius: 24, padding: '20px 20px 20px', color: '#fff',
      background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary, #e14d1a) 100%, white 28%), var(--brand-primary, #e14d1a) 55%, color-mix(in srgb, var(--brand-primary, #e14d1a) 100%, black 22%))',
      boxShadow: '0 12px 28px color-mix(in srgb, var(--brand-primary, #e14d1a) 38%, transparent)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: 11, letterSpacing: 1.5, fontWeight: 700, fontFamily: FONT_BODY, opacity: 0.85,
        }}>
          MONTH OVERVIEW
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: FONT_BODY, opacity: 0.85 }}>
          {overview.monthLabel}
        </span>
      </div>

      {/* Revenue headline. Always carries its source underneath, so a
          pipeline-derived figure is never mistaken for the books. */}
      <div data-testid="month-revenue" style={{ marginTop: 12 }}>
        <div style={{ fontSize: 34, lineHeight: 1.05, ...NUM_DISPLAY }}>
          {moneyShort(revenue.cents)}
        </div>
        <div style={{
          fontSize: 10.5, letterSpacing: 0.5, fontWeight: 600, fontFamily: FONT_BODY,
          opacity: 0.85, marginTop: 5,
        }}>
          REVENUE THIS MONTH
        </div>
        <div style={{ fontSize: 10.5, fontFamily: FONT_BODY, opacity: 0.75, marginTop: 2 }}>
          {revenue.sourceLabel}
        </div>
      </div>

      {/* Six supporting stats: activity, crew, attention, reputation */}
      <style>{`
        @media (max-width: 640px) {
          .month-overview-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
      <div className="month-overview-grid" style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14,
      }}>
        <StatTile
          icon={<Wrench size={13} weight="bold" />}
          label="JOBS COMPLETED"
          big={<CountedNumber value={overview.jobsCompleted.value} />}
          trend={{ pct: overview.jobsCompleted.pct }}
        />
        <StatTile
          icon={<UsersThree size={13} weight="bold" />}
          label="NEW LEADS"
          big={<CountedNumber value={overview.leadsAcquired.value} />}
          trend={{ pct: overview.leadsAcquired.pct }}
        />
        <StatTile
          icon={<Robot size={13} weight="bold" />}
          label="AGENTS ACTIVE"
          big={<>{activeAgents}/{AUTO_MATE_AGENT_COUNT}</>}
          sub="of your Auto Mate crew"
        />
        {/* Placeholder until the attention queue exists. Deliberately not "0":
            a zero would claim nothing needs the client, which we cannot yet
            say truthfully. */}
        <StatTile
          icon={<Warning size={13} weight="bold" />}
          label="NEEDS ATTENTION"
          big={<span style={{ fontSize: 15, fontFamily: FONT_BODY }}>coming soon</span>}
        />
        <StatTile
          icon={<Star size={13} weight="fill" />}
          label="REVIEWS COLLECTED"
          big={<CountedNumber value={reviewsCollected} />}
        />
        <StatTile
          icon={<Clock size={13} weight="bold" />}
          label="HOURS SAVED"
          big={<>{Math.round(hoursSaved)}h</>}
          sub="handled while you worked, this week"
        />
      </div>
    </div>
  );
}
