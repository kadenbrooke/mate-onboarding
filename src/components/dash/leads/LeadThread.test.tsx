import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeadThread } from './LeadThread';
import type { LeadMessage } from '@/lib/agent/messages';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const msgs: LeadMessage[] = [
  { id: 'm1', lead_id: 'l1', session_id: 's1', direction: 'inbound', author: 'lead', channel: 'sms', body: 'you around?', created_at: '2026-07-29T20:00:00Z' },
  { id: 'm2', lead_id: 'l1', session_id: 's1', direction: 'outbound', author: 'agent', channel: 'sms', body: 'yep, whats up', created_at: '2026-07-29T20:01:00Z' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
  pushMock.mockClear();
});

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
  it('does NOT flip the driver to You when the send fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"send failed"}', { status: 502 })));
    render(<LeadThread leadId="l1" sessionId="s1" handler="agent" messages={msgs} />);
    fireEvent.change(screen.getByPlaceholderText(/type a reply/i), { target: { value: 'on my way' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/leads/l1/reply', expect.objectContaining({ method: 'POST' })));
    expect(screen.getByText(/Driver: Mate/)).toBeTruthy();
  });

  it('names the lead it belongs to, so the panel is never anonymous', () => {
    render(<LeadThread leadId="l1" sessionId="s1" handler="agent" messages={msgs} leadName="Mike R." />);
    expect(screen.getByTestId('lead-thread')).toHaveAttribute('data-lead-id', 'l1');
    expect(screen.getByText('Mike R.')).toBeTruthy();
  });

  it('scrolls itself into view on open, since a row click is a soft nav that scrolls nothing', () => {
    const scrollIntoView = vi.fn();
    // jsdom leaves scrollIntoView undefined; the component feature-detects it.
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<LeadThread leadId="l1" sessionId="s1" handler="agent" messages={msgs} />);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('closes back to the plain pipeline table', () => {
    render(<LeadThread leadId="l1" sessionId="s1" handler="agent" messages={msgs} leadName="Mike R." />);
    fireEvent.click(screen.getByRole('button', { name: /close conversation with mike r\./i }));
    expect(pushMock).toHaveBeenCalledWith('/dash/s1/pipeline');
  });

  it('says so plainly when the lead has no messages yet', () => {
    render(<LeadThread leadId="l1" sessionId="s1" handler="agent" messages={[]} leadName="Mike R." />);
    expect(screen.getByText(/no messages with mike r\. yet/i)).toBeTruthy();
  });

  // Migration 0011 mirrors jc_sms_conversations.messages into lead_messages, so a
  // real J&C thread is now a long alternating run of lead/agent turns arriving in
  // created_at order. The panel is only correct if it renders that order verbatim
  // and attributes each side right -- an agent turn shown as the lead's would put
  // words in the customer's mouth.
  it('renders a full J&C thread in order, with each side attributed correctly', () => {
    const turns: LeadMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `jc${i}`, lead_id: 'l1', session_id: 's1',
      direction: i % 2 === 0 ? 'inbound' : 'outbound',
      author: i % 2 === 0 ? 'lead' : 'agent',
      channel: 'sms',
      body: `turn ${i}`,
      created_at: new Date(Date.UTC(2026, 6, 22, 18, i)).toISOString(),
    }));
    render(<LeadThread leadId="l1" sessionId="s1" handler="agent" messages={turns} leadName="Steven M." />);

    const bodies = turns.map(t => screen.getByText(t.body));
    expect(bodies).toHaveLength(10);
    // Each bubble carries the author label as its immediately preceding sibling.
    bodies.forEach((el, i) => {
      expect(el.previousElementSibling?.textContent).toBe(i % 2 === 0 ? 'Lead' : 'Mate');
    });
    // DOM order must match the order the rows came out of the query.
    for (let i = 1; i < bodies.length; i++) {
      expect(
        bodies[i - 1].compareDocumentPosition(bodies[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});
