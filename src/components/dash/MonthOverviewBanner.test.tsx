import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const renderBanner = (
  over: Partial<{
    activeAgents: number; reviewsCollected: number; hoursSaved: number;
  }> = {},
) =>
  render(
    <MonthOverviewBanner
      overview={overview}
      sessionId="sess-1"
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

  it('links the NEW LEADS tile to the pipeline sorted by date captured', () => {
    renderBanner();
    const link = screen.getByText('NEW LEADS').closest('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/dash/sess-1/pipeline?sort=captured');
  });

  it('leaves non-drill-down tiles unlinked', () => {
    renderBanner();
    expect(screen.getByText('HOURS SAVED').closest('a')).toBeNull();
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

describe('MonthOverviewBanner revenue', () => {
  it('no longer carries a revenue headline (the Recovered card owns that number)', () => {
    renderBanner();
    expect(screen.queryByTestId('month-revenue')).toBeNull();
    expect(screen.queryByText(/REVENUE THIS MONTH/i)).toBeNull();
  });
});

describe('MonthOverviewBanner tile drill-downs', () => {
  it('scrolls to the zone that owns the number on desktop', () => {
    const scrollIntoView = vi.fn();
    const target = document.createElement('div');
    target.id = 'zone-operations';
    (target as HTMLElement).scrollIntoView = scrollIntoView;
    document.body.appendChild(target);

    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /AGENTS ACTIVE/i }));
    expect(scrollIntoView).toHaveBeenCalled();
    document.body.removeChild(target);
  });

  it('switches tab instead of scrolling on mobile', () => {
    const onSelectView = vi.fn();
    render(
      <MonthOverviewBanner
        overview={overview}
        sessionId="sess-1"
        activeAgents={3}
        reviewsCollected={0}
        hoursSaved={12}
        variant="mobile"
        onSelectView={onSelectView}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /AGENTS ACTIVE/i }));
    expect(onSelectView).toHaveBeenCalledWith('crew');
    fireEvent.click(screen.getByRole('button', { name: /REVIEWS COLLECTED/i }));
    expect(onSelectView).toHaveBeenCalledWith('money');
  });

  it('leaves NEEDS ATTENTION inert while it is still coming soon', () => {
    renderBanner();
    expect(screen.queryByRole('button', { name: /NEEDS ATTENTION/i })).toBeNull();
    expect(screen.getByText('NEEDS ATTENTION').closest('a')).toBeNull();
  });
});
