'use client';
import { useState } from 'react';
import type { Lead } from '@/lib/metrics/leads';
import { heroStats, heroSeries } from '@/lib/metrics/hero';
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

// Light-theme layout (2026-07 redesign): each zone is a large light-grey
// SectionCard holding white stat sub-cards. Mobile stacks the white cards
// directly on the warm canvas.

export function DashboardView({ session, leads, data }: {
  session: { id: string; mate_name?: string | null }; leads: Lead[]; data: DashData;
}) {
  const [view, setView] = useState<MobileView>('home');
  const hero = heroStats(leads, { monthlyRetainerCents: 100000, actionsThisWeek: data.weekActionCount, minutesPerAction: 5 }); // PLAN3: retainer from session
  const series = heroSeries(leads, data.events, { minutesPerAction: 5 });

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
  const pipelineZone = <TwinRings leads={leads} />;

  // Mobile view stacks
  const mobileHome = (
    <>
      <HeroStrip {...hero} series={series} />
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
      <a
        href={`/dash/${session.id}/leads`}
        style={{ fontSize: 13, color: 'var(--brand-primary, #e14d1a)', textDecoration: 'none', display: 'block', marginTop: 4 }}
      >
        Open full leads table
      </a>
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
      <a
        href={`/portal?session=${session.id}`}
        style={{ fontSize: 13, color: 'var(--brand-primary, #e14d1a)', textDecoration: 'none', display: 'block', marginTop: 4 }}
      >
        Chat with Mate
      </a>
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

      {/* Desktop layout */}
      <div className="dash-desktop" style={{ display: 'grid', gap: 12 }}>
        <HeroStrip {...hero} series={series} />
        <Ticker events={data.events} />
        <SectionCard>
          <JourneyRiver leads={leads} />
        </SectionCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <SectionCard title="Lead flow">{leadFlowZone}</SectionCard>
          <SectionCard>{calendarZone}</SectionCard>
          <SectionCard>{pipelineZone}</SectionCard>
          <SectionCard>{followUpZone}</SectionCard>
          <SectionCard title="Speed">{speedZone}</SectionCard>
          <SectionCard>{reputationZone}</SectionCard>
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

      <MobileNav view={view} onChange={setView} />
    </main>
  );
}

function Dim({ note }: { note?: string }) {
  return <div style={{ opacity: 0.45, fontSize: 12, marginTop: 10 }}>{note ?? 'coming online'}</div>;
}
