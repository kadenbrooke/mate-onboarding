import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DoNotContactButton } from './DoNotContactButton';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ok: true, recorded_by: 'jeff@example.com', recorded_at: '2026-10-09T12:00:00.000Z',
  }), { status: 200, headers: { 'content-type': 'application/json' } })));
});

describe('DoNotContactButton', () => {
  it('requires confirmation before recording and shows who recorded it afterward', async () => {
    render(<DoNotContactButton leadId="l1" sessionId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Do not contact' }));
    expect(screen.getByText('They asked us not to contact them')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes, do not contact' }));
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, do not contact' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/leads/l1/do-not-contact', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('Do not contact')).toBeInTheDocument();
    expect(screen.getByText(/jeff@example\.com/)).toBeInTheDocument();
  });

  it('surfaces a failed recording and does not show an opted-out state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'function is missing' }), { status: 502 })));
    render(<DoNotContactButton leadId="l1" sessionId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Do not contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, do not contact' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('function is missing');
    expect(screen.getByRole('button', { name: 'Yes, do not contact' })).toBeInTheDocument();
  });
  it('ignores a double submit and shows an RPC success even when Mate note logging warns', async () => {
    let resolve: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
    render(<DoNotContactButton leadId="l1" sessionId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Do not contact' }));
    const confirm = screen.getByRole('button', { name: 'Yes, do not contact' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve?.(new Response(JSON.stringify({
      ok: true, recorded_by: 'jeff@example.com', recorded_at: '2026-10-09T12:00:00.000Z',
      warning: 'Opt-out is active, but Mate could not save the activity note.',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await screen.findByText('Do not contact')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not save/i);
  });

  it('shows the live STOP receipt as Texted STOP', () => {
    render(<DoNotContactButton leadId="l1" sessionId="s1" initial={{ available: true, optedOut: true, source: 'text_stop', recordedBy: null, recordedAt: null }} />);
    expect(screen.getByText('Texted STOP')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Do not contact' })).toBeNull();
  });
});
