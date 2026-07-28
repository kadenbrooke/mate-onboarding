import { describe, it, expect } from 'vitest';
import { wheelWedges } from './wheel';

describe('wheelWedges', () => {
  it('assigns angle by share and radius scaled by avg value', () => {
    const w = wheelWedges([
      { service: 'A', count: 2, share: 0.5, avgCents: 400000 },
      { service: 'B', count: 2, share: 0.5, avgCents: 200000 },
    ], { minR: 30, maxR: 60 });
    expect(w[0].startDeg).toBe(0);
    expect(w[0].endDeg).toBe(180);
    expect(w[0].radius).toBe(60);          // highest avg gets maxR
    expect(w[1].radius).toBe(30);          // lowest avg gets minR
    expect(w[0].path).toMatch(/^M0,0/);    // wedge path from center
  });

  it('handles single service without NaN', () => {
    const w = wheelWedges([{ service: 'A', count: 1, share: 1, avgCents: 0 }], { minR: 30, maxR: 60 });
    expect(w[0].endDeg).toBe(360);
    expect(Number.isNaN(w[0].radius)).toBe(false);
  });
});

describe('wheelWedges proportionality (2026-07 accuracy fix)', () => {
  it('angles are exactly proportional to counts and sum to 360, even when upstream share is stale', () => {
    // share fields deliberately sum to 0.5 (top-N slice of a larger set):
    // the wheel must renormalize on count, not trust share.
    const w = wheelWedges([
      { service: 'A', count: 3, share: 0.3, avgCents: 100 },
      { service: 'B', count: 1, share: 0.1, avgCents: 200 },
      { service: 'C', count: 1, share: 0.1, avgCents: 300 },
    ], { minR: 30, maxR: 60 });
    const angles = w.map(x => x.endDeg - x.startDeg);
    expect(angles[0]).toBeCloseTo(216, 6); // 3/5 * 360
    expect(angles[1]).toBeCloseTo(72, 6);  // 1/5 * 360
    expect(angles[2]).toBeCloseTo(72, 6);
    expect(angles.reduce((a, b) => a + b, 0)).toBeCloseTo(360, 6);
    // contiguous wedges: each starts where the previous ended
    expect(w[1].startDeg).toBeCloseTo(w[0].endDeg, 9);
    expect(w[2].startDeg).toBeCloseTo(w[1].endDeg, 9);
  });

  it('zero total counts produce zero-angle wedges without NaN', () => {
    const w = wheelWedges([{ service: 'A', count: 0, share: 0, avgCents: 0 }], { minR: 30, maxR: 60 });
    expect(w[0].startDeg).toBe(0);
    expect(w[0].endDeg).toBe(0);
    expect(Number.isNaN(w[0].radius)).toBe(false);
  });
});
