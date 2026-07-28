'use client';
import { useState } from 'react';
import type { Lead } from '@/lib/metrics/leads';
import { heroStats } from '@/lib/metrics/hero';
import { Card } from './Card';
import { HeroStrip } from './HeroStrip';
import { MobileNav, type MobileView } from './MobileNav';

// Zone components land in Tasks 8-13; until each exists, Card renders a
// dimmed "coming online" body per the locked-zone pattern.
export function DashboardView({ session, leads }: {
  session: { id: string; mate_name?: string | null }; leads: Lead[];
}) {
  const [view, setView] = useState<MobileView>('home');
  const hero = heroStats(leads, { monthlyRetainerCents: 100000, actionsThisWeek: leads.length * 6, minutesPerAction: 5 }); // PLAN2: real action count from events table
  const zones = {
    leadFlow: <Card label="LEAD FLOW"><Dim /></Card>,
    calendar: <Card label="CALENDAR"><Dim note="booked appointments arrive in the next build" /></Card>,
    pipeline: <Card label="PIPELINE"><Dim /></Card>,
    followUp: <Card label="FOLLOW-UP"><Dim note="turns on with the Reactivator" /></Card>,
    speed: <Card label="SPEED"><Dim /></Card>,
    reputation: <Card label="REPUTATION"><Dim note="turns on with review collection" /></Card>,
    crew: <Card label="YOUR CREW"><Dim /></Card>,
    pulse: <Card label="SYSTEM PULSE"><Dim /></Card>,
  };
  return (
    <main>
      <div data-testid={`view-${view}`} />
      <div className="dash-desktop" style={{ display: 'grid', gap: 10 }}>
        <HeroStrip {...hero} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {zones.leadFlow}{zones.calendar}
          {zones.pipeline}{zones.followUp}
          {zones.speed}{zones.reputation}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 10 }}>
          {zones.crew}{zones.pulse}
        </div>
      </div>
      <MobileNav view={view} onChange={setView} />
    </main>
  );
}

function Dim({ note }: { note?: string }) {
  return <div style={{ opacity: 0.45, fontSize: 12, marginTop: 10 }}>{note ?? 'coming online'}</div>;
}
