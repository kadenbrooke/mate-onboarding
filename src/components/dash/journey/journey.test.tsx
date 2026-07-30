import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JourneyRiver } from './JourneyRiver';
import type { Lead } from '@/lib/metrics/leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'A', phone: null, city: null, service: null,
  source: 'referral', referrer_name: null, score: null, status: 'won', quote_cents: 500000,
  contacted: true, after_hours: false, first_reply_seconds: 5,
  created_at: new Date().toISOString(), ...over,
});

describe('JourneyRiver', () => {
  it('renders source labels, quoted count, and won outcome', () => {
    render(<JourneyRiver leads={[lead({}), lead({ source: 'missed_call', status: 'open' })]} />);
    expect(screen.getByText('LEAD JOURNEY')).toBeInTheDocument();
    // Labels appear once per breakpoint variant (desktop + mobile SVGs)
    expect(screen.getAllByText(/Won 1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Still open 1/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing-yet state with zero leads', () => {
    render(<JourneyRiver leads={[]} />);
    expect(screen.getByText(/leads will flow here/i)).toBeInTheDocument();
  });

  it('renders a Lost outcome node fed from Quoted in both variants', () => {
    const { container } = render(<JourneyRiver leads={[
      lead({}),
      lead({ source: 'missed_call', status: 'lost' }),
      lead({ source: 'web_form', status: 'open' }),
    ]} />);
    // Once per breakpoint variant (desktop + mobile SVGs)
    expect(screen.getAllByText(/Lost 1/).length).toBe(2);
    // Node + link exist in the desktop variant alongside the other outcomes
    const desktopTexts = Array.from(container.querySelectorAll('.jr-desktop text')).map(t => t.textContent);
    expect(desktopTexts.some(t => /Lost 1/.test(t ?? ''))).toBe(true);
    expect(desktopTexts.some(t => /Won 1/.test(t ?? ''))).toBe(true);
  });

  it('omits the Lost node entirely when no leads are lost', () => {
    render(<JourneyRiver leads={[lead({}), lead({ source: 'missed_call', status: 'open' })]} />);
    expect(screen.queryByText(/Lost/)).toBeNull();
  });

  it('3 distinct sources render 3 ribbon paths with unique destination y-coords', () => {
    const leads = [
      lead({ source: 'referral', status: 'won' }),
      lead({ source: 'missed_call', status: 'open' }),
      lead({ source: 'web_form', status: 'open' }),
    ];
    const { container } = render(<JourneyRiver leads={leads} />);
    // Scope to the desktop variant: the mobile SVG renders its own set
    const ribbons = container.querySelectorAll('.jr-desktop [data-ribbon]');
    expect(ribbons).toHaveLength(3);
    // Each ribbon's d attribute must be unique (distinct destination y slices)
    const dAttrs = Array.from(ribbons).map(el => el.getAttribute('d'));
    const unique = new Set(dAttrs);
    expect(unique.size).toBe(3);
  });

  it('renders a narrow mobile SVG variant so labels stay readable at 390px', () => {
    const { container } = render(<JourneyRiver leads={[lead({})]} />);
    const desktop = container.querySelector('svg.jr-desktop');
    const mobile = container.querySelector('svg.jr-mobile');
    expect(desktop).toBeTruthy();
    expect(mobile).toBeTruthy();
    expect(desktop!.getAttribute('viewBox')).toBe('0 0 640 170');
    expect(mobile!.getAttribute('viewBox')).toBe('0 0 360 170');
    // Mobile variant carries the same ribbon data
    expect(container.querySelectorAll('.jr-mobile [data-ribbon]').length).toBe(1);
  });
});
