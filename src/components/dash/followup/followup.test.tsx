import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CascadeFunnel } from './CascadeFunnel';
import { FollowUpZone } from './FollowUpZone';

describe('CascadeFunnel', () => {
  it('renders one indented row per stage with counts', () => {
    render(<CascadeFunnel stages={[
      { label: 'Database', count: 740 },
      { label: 'Contacted', count: 156 },
      { label: 'Rebooked', count: 9, highlight: 'green' },
    ]} />);
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('740')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });
});

describe('FollowUpZone', () => {
  const reactivation = {
    pool_size: 740, contacted: 156, replied: 26, rebooked: 9, recovered_cents: 1140000,
    dormancy_3_6mo: 210, dormancy_6_12mo: 260, dormancy_1_2yr: 180, dormancy_2yr_plus: 90,
  };
  it('renders funnel, recovered revenue, dormancy, wins', () => {
    render(<FollowUpZone reactivation={reactivation} wins={[
      { id: 'w1', customer_name: 'Mike H.', dormant_months: 8, won_cents: 35000, state: 'won' },
    ]} />);
    expect(screen.getByText(/recovered revenue/i)).toBeInTheDocument();
    expect(screen.getByText('$11.4k')).toBeInTheDocument();
    expect(screen.getByText('CONTACTS BY DORMANCY')).toBeInTheDocument();
    expect(screen.getByText('Mike H.')).toBeInTheDocument();
  });
  it('renders the ComingSoon cover, not bare text, when reactivation is null', () => {
    render(<FollowUpZone reactivation={null} wins={[]} />);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText(/reactivator/i)).toBeInTheDocument();
    expect(screen.queryByText(/^turns on with the Reactivator$/i)).toBeNull();
  });
  it('renders empty wins placeholder when reactivation present and wins empty', () => {
    render(<FollowUpZone reactivation={reactivation} wins={[]} />);
    expect(screen.getByText('RECENT WINS')).toBeInTheDocument();
    expect(screen.getByText('No wins yet, the machine is working')).toBeInTheDocument();
  });
});
