'use client';
import { useState } from 'react';
import type { Lead } from '@/lib/metrics/leads';
import { heroStats } from '@/lib/metrics/hero';
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

export function DashboardView({ session, leads }: {
  session: { id: string; mate_name?: string | null }; leads: Lead[];
}) {
  const [view, setView] = useState<MobileView>('home');
  const hero = heroStats(leads, { monthlyRetainerCents: 100000, actionsThisWeek: leads.length * 6, minutesPerAction: 5 }); // PLAN2: real action count from events table

  // Stub zones for features arriving in Plan 2
  const calendarStub = <Card label="CALENDAR"><Dim note="booked appointments arrive in the next build" /></Card>;
  const followUpStub = <Card label="FOLLOW-UP"><Dim note="turns on with the Reactivator" /></Card>;
  const speedStub = <Card label="SPEED"><Dim /></Card>;
  const reputationStub = <Card label="REPUTATION"><Dim note="turns on with review collection" /></Card>;
  const crewStub = <Card label="YOUR CREW"><Dim /></Card>;
  const pulseStub = <Card label="SYSTEM PULSE"><Dim /></Card>;
  const setupStub = <Card label="SETUP"><Dim note="unlock checklist arrives with the next build" /></Card>;

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
      <HotLeads leads={leads} sessionId={session.id} />
      {calendarStub}
      {pulseStub}
    </>
  );

  const mobileLeads = (
    <>
      <TrendCard leads={leads} />
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
      {speedStub}
    </>
  );

  const mobileMoney = (
    <>
      <TwinRings leads={leads} />
      {followUpStub}
      {reputationStub}
    </>
  );

  const mobileCrew = (
    <>
      {crewStub}
      <a
        href={`/portal?session=${session.id}`}
        style={{ fontSize: 13, color: 'var(--brand-primary, #e14d1a)', textDecoration: 'none', display: 'block', marginTop: 4 }}
      >
        Chat with Mate
      </a>
      {setupStub}
      {pulseStub}
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {leadFlowZone}{calendarStub}
          {pipelineZone}{followUpStub}
          {speedStub}{reputationStub}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 10 }}>
          {crewStub}{pulseStub}
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
