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
