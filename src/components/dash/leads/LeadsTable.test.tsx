import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeadsTable } from './LeadsTable';
import type { Lead } from '@/lib/metrics/leads';

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

const lead = (over: Partial<Lead>): Lead => ({
  id: 'l1', name: 'Mike R.', city: 'Orem', service: 'Driveway', source: 'referral',
  referrer_name: null, score: 92, status: 'open', quote_cents: 1840000, contacted: false,
  after_hours: false, first_reply_seconds: 20, created_at: new Date().toISOString(), ...over,
});

describe('LeadsTable', () => {
  it('spotlights the row matching spotlightId', () => {
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId="l1" />);
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-spotlight', 'true');
  });

  it('marking won posts to the status API and updates the row optimistically', async () => {
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: /won/i }));
    expect(fetch).toHaveBeenCalledWith('/api/leads/l1/status', expect.objectContaining({ method: 'PATCH' }));
    expect(await screen.findByTestId('lead-row-l1')).toHaveAttribute('data-status', 'won');
  });
});
