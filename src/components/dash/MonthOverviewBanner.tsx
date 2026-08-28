'use client';
import Link from 'next/link';
import {
  Wrench, UsersThree, Robot, Warning, Star, Clock, ArrowUpRight, ArrowDownRight,
} from '@phosphor-icons/react';
import { useCountUp } from './useCountUp';
import { FONT_BODY, NUM_DISPLAY, MQ_DASH_MOBILE } from '@/lib/theme';
import { AUTO_MATE_AGENT_COUNT } from '@/lib/metrics/crew';
import type { MonthOverview } from '@/lib/metrics/monthOverview';
import type { MobileView } from './MobileNav';

// Sits above the Hero strip: the "CEO glance" zone. Six stats covering the
// questions an owner actually asks in the first 30 seconds -- are we busy, how
// much of the crew is working, what needs me, are customers happy.
//
// Money deliberately lives BELOW this card, not on it: the Recovered card owns
// the revenue figure, and stacking a second one here read as a contradiction.
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
      display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0, maxWidth: '100%',
      fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
      background: 'rgba(255,255,255,0.22)',
      borderRadius: 99, padding: '3px 8px',
    }}>
      <Arrow size={11} weight="bold" aria-hidden />
      {up ? '+' : ''}{pct}%
    </span>
  );
}

function StatTile({ icon, label, big, sub, trend, href, onActivate }: {
  icon: React.ReactNode; label: string; big: React.ReactNode; sub?: string;
  trend?: { pct: number };
  /** Navigates to another route (NEW LEADS -> the pipeline sheet). */
  href?: string;
  /** Moves to the card on THIS page that owns the number: scrolls to the zone
   *  on desktop, switches tab on mobile. Ignored when href is set. */
  onActivate?: () => void;
}) {
  const tileStyle: React.CSSProperties = {
    display: 'block', minWidth: 0, maxWidth: '100%', background: 'rgba(255,255,255,0.14)',
    borderRadius: 14, padding: '12px 14px', color: 'inherit', textDecoration: 'none',
    // Nothing inside a tile may push the card past the screen edge. Long words
    // break rather than widen the track (Android Chrome's fallback body font +
    // the OS text-scaling setting both make these labels wider than they are on
    // iOS, which is how the whole banner ended up spilling off a Pixel).
    overflowWrap: 'anywhere',
  };
  const body = (
    <>
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
        <span style={{ minWidth: 0 }}>{label}</span>
      </div>
      {/* Bottom row: big number lower-left, trend pill lower-right -- not
          the header row, so it never crowds a two-line-wrapped label. Wraps
          when the number and the pill cannot share a line, since the pill
          never shrinks and the number cannot break mid-digit. */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8, marginTop: 8, minWidth: 0,
      }}>
        <div style={{ fontSize: 24, lineHeight: 1, minWidth: 0, ...NUM_DISPLAY }}>{big}</div>
        {trend && <TrendPill pct={trend.pct} />}
      </div>
      {sub && (
        <div style={{ fontSize: 10.5, fontFamily: FONT_BODY, marginTop: 4, opacity: 0.75 }}>{sub}</div>
      )}
    </>
  );
  // Tiles with no destination stay plain divs -- no hover affordance we cannot
  // honour. NEEDS ATTENTION is the current example: still "coming soon".
  if (href) {
    return (
      <Link href={href} className="stat-tile-link" style={tileStyle} aria-label={`${label}: open pipeline`}>
        {body}
      </Link>
    );
  }
  if (onActivate) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="stat-tile-link"
        style={{ ...tileStyle, textAlign: 'left', border: 'none', font: 'inherit', cursor: 'pointer' }}
        aria-label={`${label}: jump to details`}
      >
        {body}
      </button>
    );
  }
  return <div style={tileStyle}>{body}</div>;
}

function CountedNumber({ value }: { value: number }) {
  const n = useCountUp(value, 900);
  return <>{Math.round(n)}</>;
}

// Each tile drills into the card that already owns its number. Desktop scrolls
// to the zone anchor MovableDashGrid renders; mobile has no such anchor (zones
// live on separate tabs) so it switches tab instead. NEEDS ATTENTION has no
// entry: it is still "coming soon", so there is nothing to jump to.
const TILE_TARGETS = {
  jobs:     { zoneId: 'zone-pipeline',   view: 'money' as MobileView },
  agents:   { zoneId: 'zone-operations', view: 'crew'  as MobileView },
  reviews:  { zoneId: 'zone-reputation', view: 'money' as MobileView },
  hours:    { zoneId: 'zone-operations', view: 'crew'  as MobileView },
};

export function MonthOverviewBanner({
  overview, activeAgents, reviewsCollected, hoursSaved, sessionId,
  variant = 'desktop', onSelectView,
}: {
  overview: MonthOverview;
  /** Route id for the drill-down links off the tiles (NEW LEADS -> pipeline). */
  sessionId: string;
  /** Which surface this instance is rendered on. The banner renders twice (the
   *  desktop grid and the mobile home tab) and the two drill down differently. */
  variant?: 'desktop' | 'mobile';
  /** Mobile only: switch to the tab holding the card behind a tile. */
  onSelectView?: (v: MobileView) => void;
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
  // Desktop scrolls the zone into view (same mechanism as the IconRail);
  // mobile hands the tab switch back to DashboardView, which owns that state.
  const activate = (target: { zoneId: string; view: MobileView }) => () => {
    if (variant === 'mobile') { onSelectView?.(target.view); return; }
    document.getElementById(target.zoneId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{
      borderRadius: 24, padding: '20px 20px 20px', color: '#fff',
      // Backstop: the banner is a grid item, and a grid item's automatic
      // minimum size is its min-content width -- without these it can grow
      // past its column and run off the right edge of the phone.
      minWidth: 0, maxWidth: '100%', overflow: 'hidden',
      background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary, #e14d1a) 100%, white 28%), var(--brand-primary, #e14d1a) 55%, color-mix(in srgb, var(--brand-primary, #e14d1a) 100%, black 22%))',
      boxShadow: '0 12px 28px color-mix(in srgb, var(--brand-primary, #e14d1a) 38%, transparent)',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8, minWidth: 0,
      }}>
        <span style={{
          fontSize: 11, letterSpacing: 1.5, fontWeight: 700, fontFamily: FONT_BODY, opacity: 0.85,
          minWidth: 0,
        }}>
          MONTH OVERVIEW
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, fontFamily: FONT_BODY, opacity: 0.85, minWidth: 0,
        }}>
          {overview.monthLabel}
        </span>
      </div>

      {/* The REVENUE THIS MONTH headline used to sit here. Removed 2026-08:
          the Recovered card directly below already carries a revenue figure,
          and two large money numbers stacked inches apart read as one number
          contradicting itself. Note they are NOT the same measure -- this one
          was whole-business revenue (QuickBooks when connected), Recovered is
          agent-attributed -- so if a business-revenue number is ever wanted
          back, it needs its own labelled home, not this slot. */}

      {/* Six supporting stats: activity, crew, attention, reputation */}
      <style>{`
        ${MQ_DASH_MOBILE} {
          .month-overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        /* Very narrow / heavily text-scaled screens: two columns stop being
           readable long before they stop fitting, so drop to one. */
        @media (max-width: 340px) {
          .month-overview-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
        .stat-tile-link { transition: background 120ms ease; }
        .stat-tile-link:hover { background: rgba(255,255,255,0.24) !important; }
        .stat-tile-link:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      `}</style>
      <div className="month-overview-grid" style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 14,
        minWidth: 0,
      }}>
        <StatTile
          icon={<Wrench size={13} weight="bold" />}
          label="JOBS COMPLETED"
          big={<CountedNumber value={overview.jobsCompleted.value} />}
          trend={{ pct: overview.jobsCompleted.pct }}
          onActivate={activate(TILE_TARGETS.jobs)}
        />
        <StatTile
          icon={<UsersThree size={13} weight="bold" />}
          label="NEW LEADS"
          big={<CountedNumber value={overview.leadsAcquired.value} />}
          trend={{ pct: overview.leadsAcquired.pct }}
          href={`/dash/${sessionId}/pipeline?sort=captured`}
        />
        <StatTile
          icon={<Robot size={13} weight="bold" />}
          label="AGENTS ACTIVE"
          big={<>{activeAgents}/{AUTO_MATE_AGENT_COUNT}</>}
          sub="of your Auto Mate crew"
          onActivate={activate(TILE_TARGETS.agents)}
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
          onActivate={activate(TILE_TARGETS.reviews)}
        />
        <StatTile
          icon={<Clock size={13} weight="bold" />}
          label="HOURS SAVED"
          big={<>{Math.round(hoursSaved)}h</>}
          sub="handled while you worked, this week"
          onActivate={activate(TILE_TARGETS.hours)}
        />
      </div>
    </div>
  );
}
