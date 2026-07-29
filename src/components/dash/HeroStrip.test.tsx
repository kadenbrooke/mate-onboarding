import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HeroStrip } from './HeroStrip';

const series = {
  recovered: { buckets: [1, 2, 3], trendPct: 10 },
  hours: { buckets: [1, 2, 3], trendPct: 5 },
  actions: { buckets: [1, 2, 3], trendPct: -2 },
};
const recovered = {
  points: [{ date: '2026-07-01', cents: 1000 }, { date: '2026-07-02', cents: 2500 }],
  deltaCents: 1500,
};

describe('HeroStrip mobile stacking', () => {
  it('ships the mobile rule that stops the stat cards being crushed by the dark card min-width', () => {
    const { container } = render(
      <HeroStrip
        recoveredCents={250000} roiMultiple={2.5} hoursSaved={12} actions={40}
        series={series} recovered={recovered}
      />,
    );
    const strip = container.querySelector('.hero-strip');
    expect(strip).toBeTruthy();
    // Dark Recovered card + two white stat cards carry the breakpoint classes
    expect(container.querySelector('.hero-strip .hero-dark')).toBeTruthy();
    expect(container.querySelectorAll('.hero-strip .hero-card')).toHaveLength(2);
    // The 640px rule makes the dark card full-row and lets stat cards share a row
    const css = strip!.querySelector('style')?.textContent ?? '';
    expect(css).toContain('max-width: 640px');
    expect(css).toContain('.hero-strip .hero-dark');
    expect(css).toContain('flex: 1 1 100%');
  });
});
