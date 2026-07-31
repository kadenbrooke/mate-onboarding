'use client';
import { useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import type { Lead } from '@/lib/metrics/leads';
import { heroStats, heroSeries } from '@/lib/metrics/hero';
import { recoveredDailySeries, recoveredWowDeltaCents } from '@/lib/metrics/recovered';
import { Card, SectionCard } from './Card';
import { HeroStrip } from './HeroStrip';
import { MonthOverviewBanner } from './MonthOverviewBanner';
import { monthOverview } from '@/lib/metrics/monthOverview';
import { MobileNav, type MobileView } from './MobileNav';
import { useDashEditing } from '@/lib/dashEditing';
import { TrendCard } from './leadflow/TrendCard';
import { HotLeads } from './leadflow/HotLeads';
import { SourceDonut } from './leadflow/SourceDonut';
import { ValueWheel } from './leadflow/ValueWheel';
import { AreaBars } from './leadflow/AreaBars';
import { TwinRings } from './pipeline/TwinRings';
import { SpeedZone } from './speed/SpeedZone';
import { Ticker } from './Ticker';
import { BookedCalendar } from './calendar/BookedCalendar';
import { FollowUpZone } from './followup/FollowUpZone';
import { ReputationZone } from './reputation/ReputationZone';
import { CrewRoster } from './ops/CrewRoster';
import { AssistantView } from './assistant/AssistantView';
import { AdPerformanceZone } from './ads/AdPerformanceZone';
import { MovableDashGrid, type MovableCard } from './MovableDashGrid';
import { SortableStack, type StackItem } from './SortableStack';
import type { DashData } from './types';
import {
  BG_CARD, CARD_SHADOW, FONT_BODY, TEXT_DARK, brandVar,
} from '@/lib/theme';

// Light-theme layout (2026-07 redesign): each zone is a large light-grey
// SectionCard holding white stat sub-cards. Mobile stacks the white cards
// directly on the warm canvas.

/** Mobile row link styled as a white card: full-width 48px touch target. */
function LinkCard({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        minHeight: 48, padding: '0 16px', borderRadius: 16,
        background: BG_CARD, boxShadow: CARD_SHADOW, textDecoration: 'none',
        color: TEXT_DARK, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600,
      }}
    >
      {label}
      <CaretRight size={15} weight="bold" color={brandVar} aria-hidden />
    </a>
  );
}

export function DashboardView({ session, leads, data }: {
  session: { id: string; mate_name?: string | null }; leads: Lead[]; data: DashData;
}) {
  const [view, setView] = useState<MobileView>('home');
  const { editing, setEditing } = useDashEditing();
  // Tab switch resets scroll: landing mid-scroll on a shorter view strands
  // the user below the fold. try/catch: jsdom has no scrollTo implementation.
  const switchView = (v: MobileView) => {
    setView(v);
    try { window.scrollTo({ top: 0 }); } catch { /* non-browser env */ }
  };
  const hero = heroStats(leads, { monthlyRetainerCents: 100000, actionsThisWeek: data.weekActionCount, minutesPerAction: 5 }); // PLAN3: retainer from session
  const series = heroSeries(leads, data.events, { minutesPerAction: 5 });
  // Daily cumulative series + WoW dollar delta for the Mercury-style dark card
  const recovered = { points: recoveredDailySeries(leads), deltaCents: recoveredWowDeltaCents(leads) };
  const overview = monthOverview(leads, data.events);

  // Calendar zone
  const calendarZone = <BookedCalendar appointments={data.appointments} />;

  // Follow-up zone
  const followUpZone = <FollowUpZone reactivation={data.reactivation} wins={data.wins} />;

  // Reputation zone
  const reputationZone = <ReputationZone reputation={data.reputation} reviews={data.reviews} />;

  // Ad Performance zone (Meta spend + cost-per-lead)
  const adPerformanceZone = <AdPerformanceZone ads={data.ads} />;

  // Stub zone for features arriving in a future plan
  const setupStub = <Card label="SETUP"><Dim note="unlock checklist arrives with the next build" /></Card>;

  // Speed zone
  const speedZone = <SpeedZone leads={leads} events={data.events} />;

  // Lead-flow zone: trend on top, 2x2 stat grid below (quality gauge lives
  // on the HOT RIGHT NOW card since the 2026-07 merge).
  const leadFlowZone = (
    <div style={{ display: 'grid', gap: 10 }}>
      <TrendCard leads={leads} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <HotLeads leads={leads} sessionId={session.id} />
        <SourceDonut leads={leads} />
        <ValueWheel leads={leads} />
        <AreaBars leads={leads} />
      </div>
    </div>
  );
  // Desktop movable card set. Geometry (x/y/w) is the founder-designed default:
  // Calendar full-width on top, then a left column (Lead flow, Speed, Pipeline,
  // Ad performance) and a right column (Lead journey, Follow-up, Reputation,
  // Operations). Heights are measured at runtime by MovableDashGrid; the `id`s
  // remain the IconRail scroll anchors.
  const movableCards: MovableCard[] = [
    { id: 'zone-calendar', x: 0, y: 0, w: 12, node: (
      <SectionCard title="Calendar"><BookedCalendar appointments={data.appointments} showLabel={false} wide /></SectionCard>
    ) },
    { id: 'zone-leadflow', x: 0, y: 1, w: 6, node: (
      <SectionCard title="Lead flow">{leadFlowZone}</SectionCard>
    ) },
    { id: 'zone-speed', x: 0, y: 2, w: 6, node: (
      <SectionCard title="Speed to lead">{speedZone}</SectionCard>
    ) },
    { id: 'zone-followup', x: 6, y: 2, w: 6, node: (
      <SectionCard title="Follow-up engine"><FollowUpZone reactivation={data.reactivation} wins={data.wins} showLabel={false} /></SectionCard>
    ) },
    { id: 'zone-pipeline', x: 0, y: 3, w: 6, node: (
      <SectionCard title="Pipeline"><TwinRings leads={leads} showLabel={false} /></SectionCard>
    ) },
    { id: 'zone-reputation', x: 6, y: 3, w: 6, node: (
      <SectionCard title="Reputation"><ReputationZone reputation={data.reputation} reviews={data.reviews} showLabel={false} /></SectionCard>
    ) },
    { id: 'zone-ads', x: 0, y: 4, w: 6, node: (
      <SectionCard title="Ad performance"><AdPerformanceZone ads={data.ads} showLabel={false} /></SectionCard>
    ) },
    { id: 'zone-operations', x: 6, y: 4, w: 6, node: (
      <SectionCard title="Operations">
        <CrewRoster capabilities={data.capabilities} />
      </SectionCard>
    ) },
  ];

  // Mobile view stacks. Each non-assistant tab is a reorderable list
  // (SortableStack); on 'home' the Hero strip + Ticker stay pinned above the
  // sortable cards. Reorder-only (resize is desktop-only). The assistant tab is
  // a full chat view, rendered directly below (never reorderable).
  const mobileStacks: Record<Exclude<MobileView, 'assistant'>, StackItem[]> = {
    home: [
      { id: 'm-hotleads', node: <HotLeads leads={leads} sessionId={session.id} /> },
      { id: 'm-calendar', node: calendarZone },
    ],
    // Order (2026-07 design pass): Leads, Open full leads table, Source,
    // Service. By Area + Speed to lead weren't part of that spec, so they
    // stay appended at the end rather than being dropped. Lead Journey is
    // pulled for now (2026-07): its Won/Open/Lost split now lives as the
    // outcome strip inside the Leads card (TrendCard) instead -- see
    // JourneyRiver.tsx, still in the tree in case it comes back.
    leads: [
      { id: 'm-trend', node: <TrendCard leads={leads} /> },
      { id: 'm-leadslink', node: <LinkCard href={`/dash/${session.id}/leads`} label="Open full leads table" /> },
      { id: 'm-source', node: <SourceDonut leads={leads} /> },
      { id: 'm-value', node: <ValueWheel leads={leads} /> },
      { id: 'm-area', node: <AreaBars leads={leads} /> },
      { id: 'm-speed', node: speedZone },
    ],
    money: [
      { id: 'm-pipeline', node: <TwinRings leads={leads} /> },
      { id: 'm-ads', node: adPerformanceZone },
      { id: 'm-followup', node: followUpZone },
      { id: 'm-reputation', node: reputationZone },
    ],
    crew: [
      { id: 'm-crew', node: <CrewRoster capabilities={data.capabilities} /> },
      { id: 'm-chatlink', node: <LinkCard href={`/portal?session=${session.id}`} label="Chat with Mate" /> },
      { id: 'm-setup', node: setupStub },
    ],
  };

  return (
    <main>
      <style>{`
        @media (max-width: 640px) { .dash-desktop { display: none !important; } }
        @media (min-width: 641px) { .dash-mobile, .dash-nav { display: none !important; } }
      `}</style>

      {/* Desktop layout. Hero + Ticker stay pinned at the top; everything below
          lives in MovableDashGrid, where a client can drag to reorder and drag
          a card's SE corner to resize once they enter Customize mode. The
          default arrangement reproduces the prior two-column masonry (Calendar
          full-width on top; heights measured at runtime). Zone `id`s ride the
          grid cells so the IconRail scroll anchors still resolve. */}
      <div className="dash-desktop" data-testid="dash-desktop" style={{ display: 'grid', gap: 10 }}>
        <MonthOverviewBanner overview={overview} reputation={data.reputation} ads={data.ads} />
        <HeroStrip {...hero} series={series} recovered={recovered} />
        <Ticker events={data.events} />
        <MovableDashGrid
          sessionId={session.id}
          cards={movableCards}
          editing={editing}
          onDone={() => setEditing(false)}
        />
      </div>

      {/* Mobile layout. Each tab is a reorderable SortableStack behind the same
          Customize (editing) mode; on 'home' the Hero strip + Ticker stay
          pinned above it. `key={view}` remounts the stack per tab so its order
          state is scoped to that tab. */}
      <div
        className="dash-mobile"
        data-testid={`view-${view}`}
        style={{ display: 'grid', gap: 10 }}
      >
        {view === 'assistant' ? (
          <AssistantView sessionId={session.id} />
        ) : (
          <>
            {view === 'home' && (
              <>
                <MonthOverviewBanner overview={overview} reputation={data.reputation} ads={data.ads} />
                <HeroStrip {...hero} series={series} recovered={recovered} />
                <Ticker events={data.events} />
              </>
            )}
            <SortableStack
              key={view}
              sessionId={session.id}
              stackId={`mobile-${view}`}
              items={mobileStacks[view]}
              editing={editing}
              onDone={() => setEditing(false)}
            />
          </>
        )}
      </div>

      <MobileNav view={view} onChange={switchView} />
    </main>
  );
}

function Dim({ note }: { note?: string }) {
  return <div style={{ opacity: 0.45, fontSize: 12, marginTop: 10 }}>{note ?? 'coming online'}</div>;
}
