import { describe, it, expect } from 'vitest';
import { applyContentHeights, type DashLayout } from './layout';

const base: DashLayout = [
  { i: 'a', x: 0, y: 0, w: 6, h: 24, minH: 5 },
  { i: 'b', x: 6, y: 0, w: 6, h: 24, minH: 5 },
];

describe('applyContentHeights', () => {
  it('pins h AND minH to measured content rows (never below content)', () => {
    const out = applyContentHeights(base, { a: 9, b: 3 });
    expect(out[0]).toMatchObject({ i: 'a', h: 9, minH: 9 });
    expect(out[1]).toMatchObject({ i: 'b', h: 3, minH: 3 });
  });

  it('collapses a card taller than its content (no dead space below)', () => {
    // stored h was 24 rows but content only needs 6 -> h becomes 6.
    const out = applyContentHeights(base, { a: 6, b: 6 });
    expect(out.map((l) => l.h)).toEqual([6, 6]);
  });

  it('raises minH so a card can never be shrunk below its content', () => {
    // a tall card: minH must match content, not the old fixed floor of 5.
    const out = applyContentHeights(base, { a: 30, b: 5 });
    expect(out[0].minH).toBe(30);
  });

  it('leaves an unmeasured card exactly as given (fallback height holds)', () => {
    const out = applyContentHeights(base, { a: 8 }); // b not measured
    expect(out[0]).toMatchObject({ h: 8, minH: 8 });
    expect(out[1]).toEqual(base[1]);
  });

  it('preserves position and width, only touches height', () => {
    const out = applyContentHeights(base, { a: 7, b: 7 });
    expect(out[0]).toMatchObject({ x: 0, y: 0, w: 6 });
    expect(out[1]).toMatchObject({ x: 6, y: 0, w: 6 });
  });

  it('ignores non-finite / zero measurements defensively', () => {
    const out = applyContentHeights(base, { a: NaN, b: 0 });
    expect(out[0]).toEqual(base[0]); // NaN -> untouched
    expect(out[1].h).toBe(1); // 0 -> clamped to a 1-row minimum
  });
});
