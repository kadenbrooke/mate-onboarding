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
  it('renders quoted count and won outcome, no source-level breakdown', () => {
    render(<JourneyRiver leads={[lead({}), lead({ source: 'missed_call', status: 'open' })]} />);
    expect(screen.getByText('LEAD JOURNEY')).toBeInTheDocument();
    // Labels appear once per breakpoint variant (desktop + mobile SVGs)
    expect(screen.getAllByText(/Won 1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Still open 1/).length).toBeGreaterThanOrEqual(1);
    // Source detail now lives in the Source donut, not here.
    expect(screen.queryByText(/Missed call/i)).toBeNull();
    expect(screen.queryByText(/Referral/i)).toBeNull();
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

  it('keeps the dollar figure on Won', () => {
    render(<JourneyRiver leads={[lead({ status: 'won', quote_cents: 500000 })]} />);
    expect(screen.getAllByText(/Won 1 · \$5,000/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders a narrow mobile SVG variant so labels stay readable at 390px', () => {
    const { container } = render(<JourneyRiver leads={[lead({})]} />);
    const desktop = container.querySelector('svg.jr-desktop');
    const mobile = container.querySelector('svg.jr-mobile');
    expect(desktop).toBeTruthy();
    expect(mobile).toBeTruthy();
    expect(desktop!.getAttribute('viewBox')).toBe('0 0 480 140');
    expect(mobile!.getAttribute('viewBox')).toBe('0 0 300 140');
  });
});
