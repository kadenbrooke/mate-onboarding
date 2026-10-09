import { describe, expect, it } from 'vitest';
import { summarizeReturn } from './revenue';
import { hidePartnerBasis } from './revenueVisibility';

describe('hidePartnerBasis', () => {
  it('removes the 15% basis from the client payload', () => {
    const summary = summarizeReturn([{
      source: 'self_sourced', leads: 1, won: 1, lost: 0, job_value_cents: 100000,
      collected_cents: 50000, collected_in_window_cents: 50000, collected_30d_cents: 0,
      partner_collected_in_window_cents: 50000,
    }]);
    const client = hidePartnerBasis(summary);
    expect(client.partner).toBeNull();
    expect(client.rows[0]).not.toHaveProperty('owner');
    expect(client.rows[0]).not.toHaveProperty('partner_collected_in_window_cents');
    expect(JSON.stringify(client)).not.toMatch(/shareCents|shareBps|partnerCollected|partner_collected|owner|partner basis/i);
  });
});
