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

  it('marking a stage posts to the status API and updates the row optimistically', async () => {
    let resolveFetch!: (v: Response) => void;
    global.fetch = vi.fn(() => new Promise<Response>(r => { resolveFetch = r; })) as typeof fetch;
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    // Desktop table button: exact aria-label (mobile card uses "mark booked ...")
    fireEvent.click(screen.getByRole('button', { name: 'booked Mike R.' }));
    expect(fetch).toHaveBeenCalledWith('/api/leads/l1/status', expect.objectContaining({ method: 'PATCH' }));
    // Optimistic update is synchronous - row shows 'booked' before the fetch resolves
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-status', 'booked');
    resolveFetch({ ok: true, json: async () => ({ ok: true }) } as unknown as Response);
  });

  it('shows all three stage buttons for a lead already in the pipeline, with its stage pressed', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({ status: 'quoted' })]} sessionId="s1" spotlightId={null} />);
    // Every stage remains reachable (no static badge that hides the buttons).
    expect(screen.getByRole('button', { name: 'quoted Mike R.', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'booked Mike R.', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'serviced Mike R.', pressed: false })).toBeInTheDocument();
  });

  it('clicking the already-set stage deselects it back to open (neutral) and PATCHes status=open', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as typeof fetch;
    render(<LeadsTable leads={[lead({ status: 'serviced' })]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'serviced Mike R.' }));
    // Optimistic: row clears to the neutral open state.
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-status', 'open');
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/l1/status', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'open', session_id: 's1' }),
    }));
  });

  it('clicking another stage moves straight to it, including backwards', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as typeof fetch;
    render(<LeadsTable leads={[lead({ status: 'serviced' })]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'booked Mike R.' }));
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-status', 'booked');
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/l1/status', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'booked', session_id: 's1' }),
    }));
  });

  it('deselecting a lead does not navigate the row', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({ status: 'booked' })]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'booked Mike R.' }));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('LeadsTable contact dots', () => {
  it('fills a dot only for the contact info we actually hold', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable
      leads={[lead({ phone: '+18015551234', email: null, address: '12 Main St' })]}
      sessionId="s1" spotlightId={null}
    />);
    expect(screen.getByTestId('contact-dots-l1-phone')).toHaveAttribute('data-has', 'true');
    expect(screen.getByTestId('contact-dots-l1-email')).toHaveAttribute('data-has', 'false');
    expect(screen.getByTestId('contact-dots-l1-address')).toHaveAttribute('data-has', 'true');
  });

  it('tapping a filled dot reveals the value; an empty dot is not clickable', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable
      leads={[lead({ phone: '+18015551234', email: null })]}
      sessionId="s1" spotlightId={null}
    />);
    fireEvent.click(screen.getByTestId('contact-dots-l1-phone'));
    expect(screen.getByTestId('contact-dots-l1-popover')).toHaveTextContent('+18015551234');
    expect(screen.getByTestId('contact-dots-l1-email')).toBeDisabled();
  });

  it('opening a contact popover does not navigate the row', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({ phone: '+18015551234' })]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('contact-dots-l1-phone'));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('LeadsTable delete', () => {
  it('the trash icon asks for confirmation instead of deleting immediately', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as typeof fetch;
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('delete-lead-l1'));
    expect(screen.getByTestId('delete-lead-l1-confirm'))
      .toHaveTextContent('This action cannot be undone');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('No closes the confirmation and keeps the row', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('delete-lead-l1'));
    fireEvent.click(screen.getByTestId('delete-lead-l1-no'));
    expect(screen.queryByTestId('delete-lead-l1-confirm')).toBeNull();
    expect(screen.getByTestId('lead-row-l1')).toBeInTheDocument();
  });

  it('Yes DELETEs the lead with its session and drops the row', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as typeof fetch;
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('delete-lead-l1'));
    fireEvent.click(screen.getByTestId('delete-lead-l1-yes'));
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/l1?session_id=s1', { method: 'DELETE' });
    await waitFor(() => expect(screen.queryByTestId('lead-row-l1')).toBeNull());
  });

  it('keeps the row and surfaces an error when the delete fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Not your dashboard.' }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('delete-lead-l1'));
    fireEvent.click(screen.getByTestId('delete-lead-l1-yes'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not your dashboard.'));
    expect(screen.getByTestId('lead-row-l1')).toBeInTheDocument();
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

  it('mobile stage button shares the optimistic status state with the table row', () => {
    let resolveFetch!: (v: Response) => void;
    global.fetch = vi.fn(() => new Promise<Response>(r => { resolveFetch = r; })) as typeof fetch;
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'mark serviced Mike R.' }));
    // Both variants reflect the shared optimistic state
    expect(screen.getByTestId('lead-card-l1')).toHaveAttribute('data-status', 'serviced');
    expect(screen.getByTestId('lead-row-l1')).toHaveAttribute('data-status', 'serviced');
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
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/pipeline?spotlight=l1');
  });

  it('the trailing chevron opens the thread and is keyboard-labelled', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation with Mike R.' }));
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/pipeline?spotlight=l1');
  });

  it('marking a stage does not also navigate the row', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'quoted Mike R.' }));
    expect(pushMock).not.toHaveBeenCalled();
  });

  // The row click IS the way into a lead's SMS thread. Every per-row control
  // added to the pipeline table has to stopPropagation or it swallows that
  // click, so each one is pinned here on BOTH breakpoints.
  it('clicking a mobile card opens the thread too', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable leads={[lead({})]} sessionId="s1" spotlightId={null} />);
    fireEvent.click(screen.getByTestId('lead-card-l1'));
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/pipeline?spotlight=l1');
  });

  it('no per-row control on the desktop row swallows or hijacks the row click', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable
      leads={[lead({ phone: '+18015551234', email: 'm@x.com', address: '12 Main St' })]}
      sessionId="s1" spotlightId={null}
    />);
    for (const el of [
      screen.getByRole('button', { name: 'booked Mike R.' }),
      screen.getByTestId('contact-dots-l1-phone'),
      screen.getByTestId('driver-pill-l1'),
      screen.getByTestId('delete-lead-l1'),
    ]) {
      fireEvent.click(el);
      expect(pushMock).not.toHaveBeenCalled();
    }
    // ...and the row itself still navigates afterwards.
    fireEvent.click(screen.getByTestId('lead-row-l1'));
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/pipeline?spotlight=l1');
  });

  it('no per-row control on the mobile card swallows or hijacks the card click', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable
      leads={[lead({ phone: '+18015551234', email: 'm@x.com' })]}
      sessionId="s1" spotlightId={null}
    />);
    for (const el of [
      screen.getByRole('button', { name: 'mark serviced Mike R.' }),
      screen.getByTestId('contact-dots-card-l1-phone'),
      screen.getByTestId('driver-pill-card-l1'),
      screen.getByTestId('delete-lead-card-l1'),
    ]) {
      fireEvent.click(el);
      expect(pushMock).not.toHaveBeenCalled();
    }
    fireEvent.click(screen.getByTestId('lead-card-l1'));
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/pipeline?spotlight=l1');
  });

  it('clicking a different row while one is spotlighted switches threads', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<LeadsTable
      leads={[lead({ id: 'l1' }), lead({ id: 'l2', name: 'Dana W.' })]}
      sessionId="s1" spotlightId="l1"
    />);
    fireEvent.click(screen.getByTestId('lead-row-l2'));
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/pipeline?spotlight=l2');
  });
});
