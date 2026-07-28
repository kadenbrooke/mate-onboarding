'use client';
import { useState } from 'react';
import type { Lead } from '@/lib/metrics/leads';
import { heroStats } from '@/lib/metrics/hero';
import { actionsThisWeek } from '@/lib/metrics/events';
import { Card } from './Card';
import { HeroStrip } from './HeroStrip';
import { MobileNav, type MobileView } from './MobileNav';
import { TrendCard } from './leadflow/TrendCard';
import { HotLeads } from './leadflow/HotLeads';
import { SourceDonut } from './leadflow/SourceDonut';
import { QualityGauge } from './leadflow/QualityGauge';
import { ValueWheel } from './leadflow/ValueWheel';
import { AreaRacetrack } from './leadflow/AreaRacetrack';
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

export function DashboardView({ session, leads, data }: {
  session: { id: string; mate_name?: string | null }; leads: Lead[]; data: DashData;
}) {
  const [view, setView] = useState<MobileView>('home');
  const hero = heroStats(leads, { monthlyRetainerCents: 100000, actionsThisWeek: actionsThisWeek(data.events), minutesPerAction: 5 }); // PLAN3: retainer from session

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

  // Real widget zones
  const leadFlowZone = (
    <div style={{ display: 'grid', gap: 10 }}>
      <TrendCard leads={leads} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <HotLeads leads={leads} sessionId={session.id} />
        <SourceDonut leads={leads} />
        <QualityGauge leads={leads} />
        <ValueWheel leads={leads} />
      </div>
      <AreaRacetrack leads={leads} />
    </div>
  );
  const pipelineZone = <TwinRings leads={leads} />;

  // Mobile view stacks
  const mobileHome = (
    <>
      <HeroStrip {...hero} />
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
      <QualityGauge leads={leads} />
      <ValueWheel leads={leads} />
      <AreaRacetrack leads={leads} />
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
      <div className="dash-desktop" style={{ display: 'grid', gap: 10 }}>
        <HeroStrip {...hero} />
        <Ticker events={data.events} />
        <JourneyRiver leads={leads} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {leadFlowZone}{calendarZone}
          {pipelineZone}{followUpZone}
          {speedZone}{reputationZone}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 10 }}>
          <CrewRoster capabilities={data.capabilities} />
          <SystemPulse incidents={data.incidents} />
        </div>
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
