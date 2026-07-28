import { describe, it, expect } from 'vitest';
import { ringSegments } from './ring';

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
