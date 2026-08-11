import { describe, it, expect } from 'vitest';
import { ringSegments, ringTrackDash } from './ring';

describe('ringSegments', () => {
  it('converts values to dasharray/dashoffset for a given radius', () => {
    const segs = ringSegments([{ key: 'won', value: 50 }, { key: 'open', value: 50 }], 48);
    const c = 2 * Math.PI * 48;
    expect(segs[0].dash).toBeCloseTo(c / 2, 1);
    expect(segs[0].offset).toBe(0);
    expect(segs[1].offset).toBeCloseTo(-c / 2, 1);
  });

  it('inserts gap between segments when gapDeg provided', () => {
    const segs = ringSegments([{ key: 'a', value: 1 }, { key: 'b', value: 1 }], 48, 4);
    const c = 2 * Math.PI * 48;
    expect(segs[0].dash).toBeLessThan(c / 2);
  });

  it('handles all-zero values without NaN', () => {
    const segs = ringSegments([{ key: 'a', value: 0 }], 48);
    expect(segs[0].dash).toBe(0);
    expect(Number.isNaN(segs[0].offset)).toBe(false);
  });
});

describe('ringSegments (180-degree gauge)', () => {
  it('fits the segments into half the circle', () => {
    const c = 2 * Math.PI * 40;
    const segs = ringSegments([{ key: 'agent', value: 3 }, { key: 'human', value: 1 }], 40, 0, 180);
    // Three quarters of a half circle, then one quarter of it.
    expect(segs[0].dash).toBeCloseTo((c / 2) * 0.75, 1);
    expect(segs[1].dash).toBeCloseTo((c / 2) * 0.25, 1);
    expect(segs[1].offset).toBeCloseTo(-(c / 2) * 0.75, 1);
  });

  it('defaults to a full circle when no sweep is given', () => {
    const full = ringSegments([{ key: 'a', value: 1 }], 40);
    expect(full[0].dash).toBeCloseTo(2 * Math.PI * 40, 1);
  });
});

describe('ringTrackDash', () => {
  it('returns the arc length the background track should cover', () => {
    const c = 2 * Math.PI * 40;
    expect(ringTrackDash(40)).toBeCloseTo(c, 1);
    expect(ringTrackDash(40, 180)).toBeCloseTo(c / 2, 1);
  });
});
