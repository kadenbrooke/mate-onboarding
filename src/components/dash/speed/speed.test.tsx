import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RaceCard } from './RaceCard';
import { DayClock } from './DayClock';
import { RescueRing } from './RescueRing';
import { hourBuckets, peakBucketRange } from '@/lib/metrics/speed';

// SpeedZone (the bundled Race/Rescue/DayClock card) is gone (2026-07): Reply
// Time moved to the Crew tab and the other two got reordered relative to
// City, so DashboardView now composes these three cards individually
// instead of as one fixed group. Each card is tested standalone below.

describe('RaceCard', () => {
  it('shows warming-up copy when avgReplySeconds === 0', () => {
    render(<RaceCard avgReplySeconds={0} />);
    expect(screen.getByText('waiting for your first lead')).toBeInTheDocument();
    expect(screen.getByText(/78% of jobs go to the first responder/)).toBeInTheDocument();
    expect(screen.queryByText(/beat the average company/i)).not.toBeInTheDocument();
  });

  it('shows time and beat-average copy when avgReplySeconds > 0', () => {
    render(<RaceCard avgReplySeconds={45} />);
    expect(screen.getByText('45 sec')).toBeInTheDocument();
    expect(screen.getByText(/beat the average company/i)).toBeInTheDocument();
    expect(screen.queryByText('waiting for your first lead')).not.toBeInTheDocument();
  });
});

describe('RescueRing (big-number card)', () => {
  it('shows the rescued count as the headline stat', () => {
    render(<RescueRing rescued={3} missedTotal={5} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/of 5 missed calls became text conversations/i)).toBeInTheDocument();
  });
});

describe('hourBuckets / peakBucketRange', () => {
  it('buckets 24 hourly counts into 8 three-hour windows', () => {
    const hourCounts = new Array(24).fill(0);
    hourCounts[9] = 2; hourCounts[10] = 3; hourCounts[11] = 1; // 9a-12p window
    const buckets = hourBuckets(hourCounts);
    expect(buckets).toHaveLength(8);
    const morningWindow = buckets.find(b => b.startHour === 9);
    expect(morningWindow?.count).toBe(6);
    expect(morningWindow?.label).toBe('9a');
  });

  it('identifies the busiest window as a label range', () => {
    const hourCounts = new Array(24).fill(0);
    hourCounts[18] = 4; hourCounts[19] = 5;
    const buckets = hourBuckets(hourCounts);
    expect(peakBucketRange(buckets)).toBe('6p-9p');
  });

  it('returns null with no leads at all', () => {
    const buckets = hourBuckets(new Array(24).fill(0));
    expect(peakBucketRange(buckets)).toBeNull();
  });
});

describe('DayClock (bar chart)', () => {
  it('renders one bar per bucket and highlights the busiest window', () => {
    const hourCounts = new Array(24).fill(0);
    hourCounts[9] = 5;
    const buckets = hourBuckets(hourCounts);
    render(<DayClock buckets={buckets} />);
    expect(screen.getByText('9a-12p')).toBeInTheDocument();
    expect(screen.getByText('busiest window')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^dayclock-bar-/)).toHaveLength(8);
  });

  it('shows a no-data state with zero leads', () => {
    render(<DayClock buckets={hourBuckets(new Array(24).fill(0))} />);
    expect(screen.getByText('no leads yet')).toBeInTheDocument();
  });
});
