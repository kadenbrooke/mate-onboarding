'use client';
import type { HeroSeries } from '@/lib/metrics/hero';
import type { DailyPoint } from '@/lib/metrics/recovered';
import type { Lead } from '@/lib/metrics/leads';
import { RecoveredCard } from './RecoveredCard';
import { DriverSplitCard } from './pipeline/DriverSplitCard';

export type HeroStripSeries = { recovered: HeroSeries; hours: HeroSeries; actions: HeroSeries };

// The strip is now Recovered $ + Manual vs. Automated. HOURS SAVED and ACTIONS
// were both derived from the same assumed minutes-per-action constant, so they
// said one estimated thing twice; the driver split counts real rows instead.
// `series`, `hoursSaved` and `actions` stay in the props for the callers and
// the recovered chart, which still uses them.
export function HeroStrip({ recoveredCents, roiMultiple, recovered, leads, agentLiveAt }: {
  /** null when the client's monthly retainer is unknown: no retainer, no ROI. */
  recoveredCents: number; roiMultiple: number | null; hoursSaved?: number; actions?: number;
  series?: HeroStripSeries;
  recovered: { points: DailyPoint[]; deltaCents: number };
  leads: Lead[];
  /** Agent-live instant for the manual/automated split window. */
  agentLiveAt?: string | null;
}) {
  return (
    <div className="hero-strip" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {/* Mobile: the dark Recovered card would pin its 260px min-width and
          crush its neighbour. Below 641px each card takes a full row. */}
      <style>{`
        @media (max-width: 640px) {
          .hero-strip .hero-dark { flex: 1 1 100% !important; min-width: 100% !important; }
          .hero-strip .hero-split { flex: 1 1 100% !important; min-width: 100% !important; }
        }
      `}</style>
      {/* Recovered $: the page's ONE dark accent card, Mercury-style chart */}
      <RecoveredCard
        totalCents={recoveredCents}
        roiMultiple={roiMultiple}
        deltaCents={recovered.deltaCents}
        points={recovered.points}
      />
      <div className="hero-split" style={{ flex: 1, minWidth: 260, display: 'flex' }}>
        <DriverSplitCard leads={leads} since={agentLiveAt} />
      </div>
    </div>
  );
}
