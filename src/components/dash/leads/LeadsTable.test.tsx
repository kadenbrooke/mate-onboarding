import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeadsTable } from './LeadsTable';
import type { Lead } from '@/lib/metrics/leads';

// LeadsTable now uses useRouter() for row -> thread navigation.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
beforeEach(() => { pushMock.mockClear(); });

const lead = (over: Partial<Lead>): Lead => ({
  id: 'l1', name: 'Mike R.', city: 'Orem', service: 'Driveway', phone: null, source: 'referral',
  referrer_name: null, score: 92, status: 'open', quote_cents: 1840000, handler: 'agent',
  contacted: false, after_hours: false, first_reply_seconds: 20, created_at: new Date().toISOString(), ...over,
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
    // Desktop table button: exact aria-label (mobile card uses "mark won ...")
    fireEvent.click(screen.getByRole('button', { name: 'won Mike R.' }));
    expect(fetch).toHaveBeenCalledWith('/api/leads/l1/status', expect.objectContaining({ method: 'PATCH' }));
    // Optimistic update is synchronous - row should already show 'won' before the fetch resolves
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-status', 'won');
    // Now resolve to finish clean
    resolveFetch({ ok: true, json: async () => ({ ok: true }) } as unknown as Response);
  });
});

describe('LeadsTable mobile card list', () => {
  it('renders a mobile card per lead alongside the desktop table', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { container } = render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId="l1" />);
    const card = screen.getByTestId('lead-card-l1');
    expect(card).toHaveAttribute('data-spotlight', 'true');
    // CSS toggle classes exist so exactly one variant shows per breakpoint
    expect(container.querySelector('.leads-desktop')).toBeTruthy();
    expect(container.querySelector('.leads-mobile')).toBeTruthy();
  });

  it('mobile WON button shares the optimistic status state with the table row', () => {
    let resolveFetch!: (v: Response) => void;
    global.fetch = vi.fn(() => new Promise<Response>(r => { resolveFetch = r; })) as typeof fetch;
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'mark won Mike R.' }));
    // Both variants reflect the shared optimistic state
    expect(screen.getByTestId('lead-card-l1')).toHaveAttribute('data-status', 'won');
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-status', 'won');
    resolveFetch({ ok: true, json: async () => ({ ok: true }) } as unknown as Response);
  });
});

describe('LeadsTable Driver column', () => {
  it('renders an Agent pill for a handler=agent lead and a You pill for handler=human', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({ id: 'a', handler: 'agent' }), lead({ id: 'b', handler: 'human' })]} sessionId="s1" spotlightId={null} />);
    expect(screen.getByTestId('driver-pill-a')).toHaveAttribute('data-handler', 'agent');
    expect(screen.getByTestId('driver-pill-a')).toHaveTextContent('Agent');
    expect(screen.getByTestId('driver-pill-b')).toHaveAttribute('data-handler', 'human');
    expect(screen.getByTestId('driver-pill-b')).toHaveTextContent('You');
  });

  it('treats a null handler as agent (graceful default)', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({ handler: null })]} sessionId="s1" spotlightId={null} />);
    expect(screen.getByTestId('driver-pill-l1')).toHaveAttribute('data-handler', 'agent');
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-handler', 'agent');
  });

  it('toggling the pill PATCHes the handler endpoint with the flipped value and updates optimistically', async () => {
    let resolveFetch!: (v: Response) => void;
    global.fetch = vi.fn(() => new Promise<Response>(r => { resolveFetch = r; })) as typeof fetch;
    render(<LeadsTable leads={[lead({ handler: 'agent' })]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('driver-pill-l1'));
    expect(fetch).toHaveBeenCalledWith('/api/leads/l1/handler', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ session_id: 's1', handler: 'human' }),
    }));
    // Optimistic: row flips to human before the PATCH resolves.
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-handler', 'human');
    resolveFetch({ ok: true, json: async () => ({ ok: true }) } as unknown as Response);
    await waitFor(() => expect(screen.getByTestId('driver-pill-l1')).toHaveAttribute('data-handler', 'human'));
  });

  it('reverts the pill and shows an error when the PATCH fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    render(<LeadsTable leads={[lead({ handler: 'agent' })]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('driver-pill-l1'));
    // After the failed PATCH settles, the row reverts to agent and an error surfaces.
    await waitFor(() => expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-handler', 'agent'));
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('clicking the pill does NOT navigate the row', () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('driver-pill-l1'));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('LeadsTable row -> thread navigation', () => {
  it('clicking a row opens the lead thread via ?spotlight', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('lead-row-l1'));
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/leads?spotlight=l1');
  });

  it('the trailing chevron opens the thread and is keyboard-labelled', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation with Mike R.' }));
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/leads?spotlight=l1');
  });

  it('marking won does not also navigate the row', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'won Mike R.' }));
    expect(pushMock).not.toHaveBeenCalled();
  });
});
