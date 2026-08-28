import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroStrip } from './HeroStrip';
import type { Lead } from '@/lib/metrics/leads';
import { DASH_MOBILE_MAX } from '@/lib/theme';

const recovered = {
  points: [{ date: '2026-07-01', cents: 1000 }, { date: '2026-07-02', cents: 2500 }],
  deltaCents: 1500,
};

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'A', city: null, service: null, phone: null,
  source: 'text', referrer_name: null, score: null, status: 'open', quote_cents: null,
  contacted: true, after_hours: false, first_reply_seconds: null,
  created_at: new Date().toISOString(), ...over,
});

describe('HeroStrip', () => {
  it('ships the mobile rule that stops the cards being crushed by the dark card min-width', () => {
    const { container } = render(
      <HeroStrip recoveredCents={250000} roiMultiple={2.5} recovered={recovered} leads={[]} />,
    );
    const strip = container.querySelector('.hero-strip');
    expect(strip).toBeTruthy();
    expect(container.querySelector('.hero-strip .hero-dark')).toBeTruthy();
    expect(container.querySelector('.hero-strip .hero-split')).toBeTruthy();
    const css = strip!.querySelector('style')?.textContent ?? '';
    expect(css).toContain(`max-width: ${DASH_MOBILE_MAX}px`);
    expect(css).toContain('.hero-strip .hero-dark');
    expect(css).toContain('flex: 1 1 100%');
  });

  it('replaced the HOURS SAVED and ACTIONS cards with the driver split', () => {
    render(<HeroStrip recoveredCents={250000} roiMultiple={2.5} recovered={recovered} leads={[]} />);
    expect(screen.queryByText(/HOURS SAVED/i)).toBeNull();
    expect(screen.queryByText(/^ACTIONS$/i)).toBeNull();
    expect(screen.getByTestId('driver-center')).toBeInTheDocument();
  });

  it('reports the agent/human split from the session leads', () => {
    const leads = [
      lead({ handler: 'agent' }),
      lead({ handler: 'agent' }),
      lead({ handler: 'agent' }),
      lead({ handler: 'human' }),
    ];
    render(<HeroStrip recoveredCents={0} roiMultiple={0} recovered={recovered} leads={leads} />);
    expect(screen.getByTestId('driver-center')).toHaveTextContent('75%');
    expect(screen.getByTestId('driver-legend-agent').textContent).toContain('3');
    expect(screen.getByTestId('driver-legend-human').textContent).toContain('1');
  });
});
