import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrendCard } from './TrendCard';
import { HotLeads } from './HotLeads';
import { SourceDonut } from './SourceDonut';
import { AreaBars } from './AreaBars';
import type { Lead } from '@/lib/metrics/leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'Mike R.', city: 'Orem', service: 'Driveway',
  phone: null, source: 'referral', referrer_name: null, score: 92, status: 'open', quote_cents: 100000,
  contacted: false, after_hours: false, first_reply_seconds: 20,
  created_at: new Date().toISOString(), ...over,
});

describe('TrendCard', () => {
  it('defaults to WEEK bars and switches to sparkline on MONTH', () => {
    render(<TrendCard leads={[lead({})]} />);
    expect(screen.getByTestId('trend-bars')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'MONTH' }));
    expect(screen.getByTestId('trend-spark')).toBeInTheDocument();
  });

  it('week view renders a visible px-height bar for days with leads (regression: % height collapse)', () => {
    // A lead created now always lands in the current local week.
    render(<TrendCard leads={[lead({})]} />);
    const bars = screen.getByTestId('trend-bars').querySelectorAll('[data-testid^="trend-bar-"]');
    expect(bars).toHaveLength(7);
    const active = Array.from(bars).filter(b => b.getAttribute('data-count') !== '0');
    expect(active.length).toBeGreaterThanOrEqual(1);
    // The day holding the lead must get a real pixel height, not the old
    // collapsed 2px sliver from percentage-height-in-auto-parent.
    const h = parseFloat((active[0] as HTMLElement).style.height);
    expect(h).toBeGreaterThanOrEqual(40);
    // Zero days render as short muted bars, still visible
    const zero = Array.from(bars).find(b => b.getAttribute('data-count') === '0') as HTMLElement | undefined;
    if (zero) expect(parseFloat(zero.style.height)).toBeGreaterThanOrEqual(4);
  });
});

describe('HotLeads (with merged quality gauge)', () => {
  it('renders top uncontacted leads with score and link to leads page', () => {
    render(<HotLeads leads={[lead({ score: 92 })]} sessionId="s1" />);
    // score appears in the row and in the average gauge
    expect(screen.getAllByText('92').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringContaining('/dash/s1/leads?spotlight='));
  });

  it('shows the average quality arc on the same card', () => {
    render(<HotLeads leads={[lead({ score: 80 }), lead({ score: 60 })]} sessionId="s1" />);
    expect(screen.getByTestId('quality-arc')).toBeInTheDocument();
    // avg of 80 and 60
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText(/avg lead quality/i)).toBeInTheDocument();
  });

  it('colors scores by threshold: green >=80, amber 60-79, red <60', () => {
    render(
      <HotLeads
        leads={[lead({ score: 90, id: 'a' }), lead({ score: 65, id: 'b' }), lead({ score: 40, id: 'c' })]}
        sessionId="s1"
      />,
    );
    const el90 = screen.getByText('90');
    const el40 = screen.getByText('40');
    expect(el90).toHaveStyle({ color: '#2e8f5a' });
    expect(el40).toHaveStyle({ color: '#c0392b' });
    // Gauge average = (90+65+40)/3 = 65 -> amber sweep on the arc
    const arc = screen.getByTestId('quality-arc');
    const sweep = arc.querySelectorAll('path')[1];
    expect(sweep.getAttribute('stroke')).toBe('#c08a0a');
  });
});

describe('SourceDonut', () => {
  it('shows free count center stat', () => {
    render(<SourceDonut leads={[lead({ source: 'referral' }), lead({ source: 'missed_call' })]} />);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('FREE')).toBeInTheDocument();
  });
});

describe('AreaBars', () => {
  it('renders one horizontal bar row per city, sorted desc with counts', () => {
    render(<AreaBars leads={[
      lead({ city: 'Orem' }), lead({ city: 'Orem' }), lead({ city: 'Provo' }),
    ]} />);
    const orem = screen.getByTestId('area-bar-Orem');
    const provo = screen.getByTestId('area-bar-Provo');
    expect(orem).toBeInTheDocument();
    expect(provo).toBeInTheDocument();
    expect(orem.textContent).toContain('2');
    expect(provo.textContent).toContain('1');
    // Sorted desc: Orem (2) renders before Provo (1)
    expect(orem.compareDocumentPosition(provo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders empty note without cities', () => {
    render(<AreaBars leads={[lead({ city: null })]} />);
    expect(screen.getByText(/no area data yet/i)).toBeInTheDocument();
  });
});
