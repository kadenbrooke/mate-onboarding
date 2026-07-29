'use client';
import { useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import type { Lead } from '@/lib/metrics/leads';
import { heroStats, heroSeries } from '@/lib/metrics/hero';
import { recoveredDailySeries, recoveredWowDeltaCents } from '@/lib/metrics/recovered';
import { Card, SectionCard } from './Card';
import { HeroStrip } from './HeroStrip';
import { MobileNav, type MobileView } from './MobileNav';
import { TrendCard } from './leadflow/TrendCard';
import { HotLeads } from './leadflow/HotLeads';
import { SourceDonut } from './leadflow/SourceDonut';
import { ValueWheel } from './leadflow/ValueWheel';
import { AreaBars } from './leadflow/AreaBars';
import { TwinRings } from './pipeline/TwinRings';
import { SpeedZone } from './speed/SpeedZone';
import { JourneyRiver } from './journey/JourneyRiver';
import { Ticker } from './Ticker';
import { BookedCalendar } from './calendar/BookedCalendar';
import { FollowUpZone } from './followup/FollowUpZone';
import { ReputationZone } from './reputation/ReputationZone';
import { CrewRoster } from './ops/CrewRoster';
import { SystemPulse } from './ops/SystemPulse';
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

  // Calendar zone
  const calendarZone = <BookedCalendar appointments={data.appointments} />;

  // Follow-up zone
  const followUpZone = <FollowUpZone reactivation={data.reactivation} wins={data.wins} />;

  // Reputation zone
  const reputationZone = <ReputationZone reputation={data.reputation} reviews={data.reviews} />;

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
  // Mobile view stacks
  const mobileHome = (
    <>
      <HeroStrip {...hero} series={series} recovered={recovered} />
      <Ticker events={data.events} />
      <HotLeads leads={leads} sessionId={session.id} />
      {calendarZone}
      <SystemPulse incidents={data.incidents} />
    </>
  );

  const mobileLeads = (
    <>
      <TrendCard leads={leads} />
      <JourneyRiver leads={leads} />
      <LinkCard href={`/dash/${session.id}/leads`} label="Open full leads table" />
      <SourceDonut leads={leads} />
      <ValueWheel leads={leads} />
      <AreaBars leads={leads} />
      {speedZone}
    </>
  );

  const mobileMoney = (
    <>
      <TwinRings leads={leads} />
      {followUpZone}
      {reputationZone}
    </>
  );

  const mobileCrew = (
    <>
      <CrewRoster capabilities={data.capabilities} />
      <LinkCard href={`/portal?session=${session.id}`} label="Chat with Mate" />
      {setupStub}
      <SystemPulse incidents={data.incidents} />
    </>
  );

  const mobileViewContent: Record<MobileView, React.ReactNode> = {
    home: mobileHome,
    leads: mobileLeads,
    money: mobileMoney,
    crew: mobileCrew,
  };

  return (
    <main>
      <style>{`
        @media (max-width: 640px) { .dash-desktop { display: none !important; } }
        @media (min-width: 641px) { .dash-mobile, .dash-nav { display: none !important; } }
      `}</style>

      {/* Desktop layout. Every SectionCard carries an eyebrow label; ids are
          the icon-rail scroll anchors. Calendar (full width) and the journey
          Sankey (grid cell) swapped slots in the round-2 founder pass. */}
      <div className="dash-desktop" style={{ display: 'grid', gap: 10 }}>
        <HeroStrip {...hero} series={series} recovered={recovered} />
        <Ticker events={data.events} />
        <SectionCard id="zone-calendar" title="Calendar">
          <BookedCalendar appointments={data.appointments} showLabel={false} wide />
        </SectionCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <SectionCard id="zone-leadflow" title="Lead flow">{leadFlowZone}</SectionCard>
          <SectionCard title="Lead journey">
            <JourneyRiver leads={leads} showLabel={false} />
          </SectionCard>
          <SectionCard title="Pipeline">
            <TwinRings leads={leads} showLabel={false} />
          </SectionCard>
          <SectionCard id="zone-followup" title="Follow-up engine">
            <FollowUpZone reactivation={data.reactivation} wins={data.wins} showLabel={false} />
          </SectionCard>
          <SectionCard id="zone-speed" title="Speed to lead">{speedZone}</SectionCard>
          <SectionCard id="zone-reputation" title="Reputation">
            <ReputationZone reputation={data.reputation} reviews={data.reviews} showLabel={false} />
          </SectionCard>
        </div>
        <SectionCard title="Operations">
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 10 }}>
            <CrewRoster capabilities={data.capabilities} />
            <SystemPulse incidents={data.incidents} />
          </div>
        </SectionCard>
      </div>

      {/* Mobile layout */}
      <div
        className="dash-mobile"
        data-testid={`view-${view}`}
        style={{ display: 'grid', gap: 10 }}
      >
        {mobileViewContent[view]}
      </div>

      <MobileNav view={view} onChange={switchView} />
    </main>
  );
}

function Dim({ note }: { note?: string }) {
  return <div style={{ opacity: 0.45, fontSize: 12, marginTop: 10 }}>{note ?? 'coming online'}</div>;
}
