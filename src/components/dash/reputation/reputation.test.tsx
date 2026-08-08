import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReputationZone } from './ReputationZone';

const reputation = {
  jobs_done: 21, rate_asks: 19, rated_45: 12, on_google: 9,
  refer_asks: 12, referrals_in: 7, referrals_closed: 4, referrals_lost: 1,
  referral_revenue_cents: 1230000, avg_rating: 4.8,
};
const reviews = Array.from({ length: 10 }, (_, i) => ({
  id: String(i), rating: i < 8 ? 5 : 4, author: 'A', created_at: new Date().toISOString(),
}));

describe('ReputationZone', () => {
  it('renders twin cascades, star bars, referral ring stats', () => {
    render(<ReputationZone reputation={reputation} reviews={reviews} />);
    expect(screen.getByText('THE REPUTATION MACHINE')).toBeInTheDocument();
    expect(screen.getByText('REVIEWS')).toBeInTheDocument();
    expect(screen.getByText('REFERRALS')).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByText('$12.3k')).toBeInTheDocument();
  });
  it('renders the ComingSoon cover, not bare text, when reputation is null', () => {
    render(<ReputationZone reputation={null} reviews={[]} />);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText('Reputation')).toBeInTheDocument();
    expect(screen.queryByText(/^turns on with review collection$/i)).toBeNull();
  });

  describe('ReferralRing (legend + swap)', () => {
    it('spells out WON / LOST / OPEN referral counts in a legend WITHOUT interaction', () => {
      render(<ReputationZone reputation={reputation} reviews={reviews} />);
      // closed 4, lost 1, open = in(7) - closed(4) - lost(1) = 2
      expect(screen.getByTestId('referral-legend-won').textContent).toContain('4');
      expect(screen.getByTestId('referral-legend-lost').textContent).toContain('1');
      expect(screen.getByTestId('referral-legend-open').textContent).toContain('2');
    });

    it('rests on WON and center-swaps to OPEN on tap', () => {
      render(<ReputationZone reputation={reputation} reviews={reviews} />);
      expect(screen.getByTestId('referral-center').textContent).toBe('4');
      fireEvent.click(screen.getByTestId('referral-seg-open'));
      expect(screen.getByTestId('referral-center').textContent).toBe('2');
    });
  });
});
