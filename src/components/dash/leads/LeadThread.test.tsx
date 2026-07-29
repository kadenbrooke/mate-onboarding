import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeadThread } from './LeadThread';
import type { LeadMessage } from '@/lib/agent/messages';

const msgs: LeadMessage[] = [
  { id: 'm1', lead_id: 'l1', session_id: 's1', direction: 'inbound', author: 'lead', channel: 'sms', body: 'you around?', created_at: '2026-07-29T20:00:00Z' },
  { id: 'm2', lead_id: 'l1', session_id: 's1', direction: 'outbound', author: 'agent', channel: 'sms', body: 'yep, whats up', created_at: '2026-07-29T20:01:00Z' },
];

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 }))); });

describe('LeadThread', () => {
  it('renders each message body', () => {
    render(<LeadThread leadId="l1" sessionId="s1" handler="agent" messages={msgs} />);
    expect(screen.getByText('you around?')).toBeTruthy();
    expect(screen.getByText('yep, whats up')).toBeTruthy();
  });
  it('POSTs a reply to the reply route', async () => {
    render(<LeadThread leadId="l1" sessionId="s1" handler="agent" messages={msgs} />);
    fireEvent.change(screen.getByPlaceholderText(/type a reply/i), { target: { value: 'on my way' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/leads/l1/reply', expect.objectContaining({ method: 'POST' })));
  });
  it('PATCHes the handler route when handing back', async () => {
    render(<LeadThread leadId="l1" sessionId="s1" handler="human" messages={msgs} />);
    fireEvent.click(screen.getByRole('button', { name: /hand back to mate/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/leads/l1/handler', expect.objectContaining({ method: 'PATCH' })));
  });
});
