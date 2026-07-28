import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeadsTable } from './LeadsTable';
import type { Lead } from '@/lib/metrics/leads';

const lead = (over: Partial<Lead>): Lead => ({
  id: 'l1', name: 'Mike R.', city: 'Orem', service: 'Driveway', phone: null, source: 'referral',
  referrer_name: null, score: 92, status: 'open', quote_cents: 1840000, contacted: false,
  after_hours: false, first_reply_seconds: 20, created_at: new Date().toISOString(), ...over,
});

describe('LeadsTable', () => {
  it('spotlights the row matching spotlightId', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId="l1" />);
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-spotlight', 'true');
  });

  it('marking won posts to the status API and updates the row optimistically', async () => {
    let resolveFetch!: (v: Response) => void;
    global.fetch = vi.fn(() => new Promise<Response>(r => { resolveFetch = r; })) as typeof fetch;
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: /won/i }));
    expect(fetch).toHaveBeenCalledWith('/api/leads/l1/status', expect.objectContaining({ method: 'PATCH' }));
    // Optimistic update is synchronous — row should already show 'won' before the fetch resolves
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-status', 'won');
    // Now resolve to finish clean
    resolveFetch({ ok: true, json: async () => ({ ok: true }) } as unknown as Response);
  });
});
