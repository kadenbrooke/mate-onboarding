import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonthOverviewBanner } from './MonthOverviewBanner';
import type { MonthOverview } from '@/lib/metrics/monthOverview';

const overview: MonthOverview = {
  monthLabel: 'August',
  revenueEarned: { value: 250000, pct: 12 },
  quotedThisMonthCents: 900000,
  serviceRatePct: 40,
  jobsCompleted: { value: 4, pct: 33 },
  leadsAcquired: { value: 18, pct: -5 },
  callsHandled: { value: 22, pct: 10 },
  avgResponseSeconds: { value: 45, pct: -20 },
};

const renderBanner = (over: Partial<{ activeAgents: number; reviewsCollected: number; hoursSaved: number }> = {}) =>
  render(
    <MonthOverviewBanner
      overview={overview}
      activeAgents={over.activeAgents ?? 3}
      reviewsCollected={over.reviewsCollected ?? 0}
      hoursSaved={over.hoursSaved ?? 12}
    />,
  );

describe('MonthOverviewBanner', () => {
  it('keeps the jobs and leads tiles', () => {
    renderBanner();
    expect(screen.getByText('JOBS COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('NEW LEADS')).toBeInTheDocument();
  });

  it('replaced calls / response / rating / cost-per-lead with the new four', () => {
    renderBanner();
    for (const gone of ['CALLS HANDLED', 'AVG RESPONSE', 'RATING', 'COST / LEAD']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    for (const added of ['AGENTS ACTIVE', 'NEEDS ATTENTION', 'REVIEWS COLLECTED', 'HOURS SAVED']) {
      expect(screen.getByText(added)).toBeInTheDocument();
    }
  });

  it('shows active agents over the fixed roster size of 5', () => {
    renderBanner({ activeAgents: 3 });
    expect(screen.getByText('3/5')).toBeInTheDocument();
  });

  it('shows the literal placeholder for Needs Attention, never a zero', () => {
    renderBanner();
    expect(screen.getByText('coming soon')).toBeInTheDocument();
  });

  it('renders hours saved with the h suffix', () => {
    renderBanner({ hoursSaved: 12.4 });
    expect(screen.getByText('12h')).toBeInTheDocument();
  });
});
