import { describe, it, expect } from 'vitest';
import {
  recoveredDailySeries,
  recoveredWowDeltaCents,
  splitDollarsCents,
  sparseTickIndexes,
  scaleSeries,
  monotonePath,
  areaPath,
  nearestIndexForFraction,
} from './recovered';
import type { Lead } from './leads';

const NOW = new Date('2026-07-28T12:00:00');

function serviced(cents: number, daysAgo: number): Lead {
  return {
    id: `l-${cents}-${daysAgo}`,
    name: 'X',
    city: null,
    service: null,
    source: 'referral',
    referrer_name: null,
    score: 80,
    status: 'serviced',
    quote_cents: cents,
    contacted: true,
    after_hours: false,
    first_reply_seconds: null,
    created_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  } as Lead;
}

describe('recoveredDailySeries', () => {
  it('returns one point per day, oldest first', () => {
    const pts = recoveredDailySeries([], 30, NOW);
    expect(pts).toHaveLength(30);
    expect(new Date(pts[0].date).getTime()).toBeLessThan(new Date(pts[29].date).getTime());
    expect(pts.every(p => p.cents === 0)).toBe(true);
  });

  it('is cumulative and ends at total recovered', () => {
    const leads = [serviced(10_000, 20), serviced(5_000, 5), serviced(2_500, 0)];
    const pts = recoveredDailySeries(leads, 30, NOW);
    const values = pts.map(p => p.cents);
    // Monotone non-decreasing
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    expect(values[values.length - 1]).toBe(17_500);
  });

  it('carries wins before the window as the baseline', () => {
    const leads = [serviced(100_000, 90), serviced(5_000, 2)];
    const pts = recoveredDailySeries(leads, 30, NOW);
    expect(pts[0].cents).toBe(100_000);
    expect(pts[29].cents).toBe(105_000);
  });

  it('ignores leads that are not serviced yet', () => {
    const stillQuoted = { ...serviced(50_000, 3), status: 'quoted' } as Lead;
    const pts = recoveredDailySeries([stillQuoted], 30, NOW);
    expect(pts[29].cents).toBe(0);
  });
});

describe('recoveredWowDeltaCents', () => {
  it('is positive when this week beats last week', () => {
    expect(recoveredWowDeltaCents([serviced(10_000, 2), serviced(4_000, 10)], NOW)).toBe(6_000);
  });

  it('is negative when last week was bigger', () => {
    expect(recoveredWowDeltaCents([serviced(3_000, 1), serviced(9_000, 8)], NOW)).toBe(-6_000);
  });

  it('is zero with no recent wins', () => {
    expect(recoveredWowDeltaCents([serviced(9_000, 40)], NOW)).toBe(0);
  });
});

describe('recovered-$ is dated by service completion, not lead arrival', () => {
  /** A lead that arrived long ago and was serviced `servicedDaysAgo` ago. */
  function servicedLate(cents: number, arrivedDaysAgo: number, servicedDaysAgo: number): Lead {
    return {
      ...serviced(cents, arrivedDaysAgo),
      status_updated_at: new Date(NOW.getTime() - servicedDaysAgo * 86_400_000).toISOString(),
    } as Lead;
  }

  it('counts an old lead serviced this week in this week, not its arrival week', () => {
    // Arrived 60 days ago (outside the 30-day window), serviced 2 days ago.
    // Dated by created_at this was baseline money predating the chart; dated by
    // completion it is a win that happened inside the window.
    const leads = [servicedLate(80_000, 60, 2)];
    const pts = recoveredDailySeries(leads, 30, NOW);
    expect(pts[0].cents).toBe(0);
    expect(pts[29].cents).toBe(80_000);
  });

  it('measures the week-over-week delta from the service date', () => {
    // Both arrived 40 days ago; one was serviced this week, one last week.
    const leads = [servicedLate(10_000, 40, 2), servicedLate(4_000, 40, 10)];
    expect(recoveredWowDeltaCents(leads, NOW)).toBe(6_000);
  });

  it('still dates rows with no status stamp by created_at', () => {
    const leads = [{ ...serviced(5_000, 2), status_updated_at: null } as Lead];
    expect(recoveredWowDeltaCents(leads, NOW)).toBe(5_000);
  });
});

describe('splitDollarsCents', () => {
  it('splits dollars and pads cents', () => {
    expect(splitDollarsCents(465_976)).toEqual({ dollars: '4,659', cents: '76' });
    expect(splitDollarsCents(100_005)).toEqual({ dollars: '1,000', cents: '05' });
    expect(splitDollarsCents(0)).toEqual({ dollars: '0', cents: '00' });
  });

  it('never renders negative', () => {
    expect(splitDollarsCents(-500)).toEqual({ dollars: '0', cents: '00' });
  });
});

describe('sparseTickIndexes', () => {
  it('spreads five ticks first-to-last', () => {
    const ticks = sparseTickIndexes(30, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]).toBe(0);
    expect(ticks[4]).toBe(29);
    // strictly increasing
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });

  it('handles tiny series', () => {
    expect(sparseTickIndexes(2, 5)).toEqual([0, 1]);
    expect(sparseTickIndexes(0, 5)).toEqual([]);
  });
});

describe('scaleSeries + monotonePath + areaPath', () => {
  it('scales x across the width and inverts y', () => {
    const pts = scaleSeries([0, 50, 100], 300, 100);
    expect(pts[0].x).toBe(0);
    expect(pts[2].x).toBe(300);
    // Higher value -> smaller y (SVG down-positive)
    expect(pts[2].y).toBeLessThan(pts[0].y);
  });

  it('keeps a flat zero series inside the chart box', () => {
    const pts = scaleSeries([0, 0, 0], 300, 100);
    for (const p of pts) {
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it('monotone path starts at the first point and hits every point', () => {
    const pts = scaleSeries([0, 20, 20, 90], 300, 100);
    const d = monotonePath(pts);
    expect(d.startsWith(`M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`)).toBe(true);
    // One cubic segment per interval
    expect(d.match(/C /g)).toHaveLength(pts.length - 1);
    // Every data point appears as a segment endpoint
    for (const p of pts.slice(1)) {
      expect(d).toContain(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
    }
  });

  it('flat segments produce zero tangents (no wiggle between equal values)', () => {
    // Points 1 and 2 share a y; the connecting cubic's control points must
    // stay on that y, i.e. the curve is a straight line there.
    const pts = [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 200, y: 10 }];
    const d = monotonePath(pts);
    const firstCubic = d.split(' C ')[1];
    const [c1, c2] = firstCubic.split(' ');
    expect(c1.split(',')[1]).toBe('50.00');
    expect(c2.split(',')[1]).toBe('50.00');
  });

  it('area path closes down to the baseline', () => {
    const pts = scaleSeries([1, 2, 3], 300, 100);
    const line = monotonePath(pts);
    const area = areaPath(line, pts, 100);
    expect(area.endsWith('Z')).toBe(true);
    expect(area).toContain(',100 ');
  });

  it('empty input renders empty paths', () => {
    expect(monotonePath([])).toBe('');
    expect(areaPath('', [], 100)).toBe('');
  });
});

describe('nearestIndexForFraction', () => {
  it('maps fractions to nearest point index', () => {
    expect(nearestIndexForFraction(0, 30)).toBe(0);
    expect(nearestIndexForFraction(1, 30)).toBe(29);
    expect(nearestIndexForFraction(0.5, 31)).toBe(15);
  });

  it('clamps out-of-range fractions', () => {
    expect(nearestIndexForFraction(-0.5, 30)).toBe(0);
    expect(nearestIndexForFraction(1.7, 30)).toBe(29);
  });

  it('single-point series always hits index 0', () => {
    expect(nearestIndexForFraction(0.9, 1)).toBe(0);
  });
});
