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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <RaceCard avgReplySeconds={s.avgReplySeconds} />
      <StreakCard streakDays={s.streakDays} />
      <DayClock hourCounts={s.hourCounts} afterHoursCount={s.afterHoursCount} />
      <RescueRing rescued={s.rescued} missedTotal={s.missedTotal} />
    </div>
  );
}
