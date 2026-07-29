import { speedStats } from '@/lib/metrics/speed';
import type { Lead } from '@/lib/metrics/leads';
import type { ClientEvent } from '@/lib/metrics/events';
import { RaceCard } from './RaceCard';
import { StreakCard } from './StreakCard';
import { DayClock } from './DayClock';
import { RescueRing } from './RescueRing';

export function SpeedZone({ leads, events }: { leads: Lead[]; events: ClientEvent[] }) {
  const missedCallEvents = events.filter(e => e.kind === 'missed_call').length;
  const totalMissedCalls = missedCallEvents > 0 ? missedCallEvents : undefined;
  const s = speedStats(leads, totalMissedCalls);
  return (
    <div className="speed-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {/* Mobile: half-width columns (~160px) squish the DayClock/RescueRing
          donut + legend rows; stack the four cards full-width instead. */}
      <style>{`
        @media (max-width: 640px) { .speed-grid { grid-template-columns: 1fr !important; } }
      `}</style>
      <RaceCard avgReplySeconds={s.avgReplySeconds} />
      <StreakCard streakDays={s.streakDays} />
      <DayClock totalCount={leads.length} afterHoursCount={s.afterHoursCount} />
      <RescueRing rescued={s.rescued} missedTotal={s.missedTotal} />
    </div>
  );
}
