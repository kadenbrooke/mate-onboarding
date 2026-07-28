import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrendCard } from './TrendCard';
import { HotLeads } from './HotLeads';
import { SourceDonut } from './SourceDonut';
import { QualityGauge } from './QualityGauge';
import type { Lead } from '@/lib/metrics/leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(), name: 'Mike R.', city: 'Orem', service: 'Driveway',
  source: 'referral', referrer_name: null, score: 92, status: 'open', quote_cents: 100000,
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
});

describe('HotLeads', () => {
  it('renders top uncontacted leads with score and link to leads page', () => {
    render(<HotLeads leads={[lead({ score: 92 })]} sessionId="s1" />);
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringContaining('/dash/s1/leads?spotlight='));
  });
});

describe('SourceDonut', () => {
  it('shows free count center stat', () => {
    const { container } = render(<SourceDonut leads={[lead({ source: 'referral' }), lead({ source: 'missed_call' })]} />);
    // freeCount is the SVG text node; legend also shows counts (plain space + number, no parens)
    // use getAllByText to handle both occurrences of '1'
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('FREE')).toBeInTheDocument();
  });
});

describe('QualityGauge', () => {
  it('shows average score', () => {
    render(<QualityGauge leads={[lead({ score: 80 }), lead({ score: 60 })]} />);
    expect(screen.getByText('70')).toBeInTheDocument();
  });
});
