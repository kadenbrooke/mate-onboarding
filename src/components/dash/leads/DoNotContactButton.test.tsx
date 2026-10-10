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
});
