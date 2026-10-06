import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JobOutcomePanel, type OutcomeFields } from './JobOutcomePanel';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));

const EMPTY: OutcomeFields = { job_outcome: null, job_value_cents: null, collected_cents: null, lost_reason: null };

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;
const sentBody = () => JSON.parse(String(fetchMock().mock.calls[0][1].body));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
  refreshMock.mockClear();
});

describe('JobOutcomePanel', () => {
  it('records a won job with sold price and cash, in cents', async () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={EMPTY} />);
    expect(screen.queryByLabelText(/sold for/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /won/i }));
    fireEvent.change(screen.getByLabelText(/sold for/i), { target: { value: '$4,250.50' } });
    fireEvent.change(screen.getByLabelText(/cash collected/i), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved as won.'));
    expect(fetch).toHaveBeenCalledWith('/api/leads/l1/outcome', expect.objectContaining({ method: 'PATCH' }));
    expect(sentBody()).toEqual({ session_id: 's1', outcome: 'won', job_value_cents: 425050, collected_cents: 200000 });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('uses the number keypad for money', () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={{ ...EMPTY, job_outcome: 'won' }} />);
    expect(screen.getByLabelText(/sold for/i)).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText(/cash collected/i)).toHaveAttribute('inputmode', 'decimal');
  });

  it('refuses an amount it cannot read, without calling the server', () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={EMPTY} />);
    fireEvent.click(screen.getByRole('button', { name: /won/i }));
    fireEvent.change(screen.getByLabelText(/cash collected/i), { target: { value: 'two grand' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('status').textContent).toMatch(/dollar amount/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records a lost job with an optional reason', async () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={EMPTY} />);
    fireEvent.click(screen.getByRole('button', { name: /lost/i }));
    fireEvent.change(screen.getByLabelText(/why was it lost/i), { target: { value: 'cheaper bid' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sentBody()).toEqual({ session_id: 's1', outcome: 'lost', lost_reason: 'cheaper bid' });
  });

  it('shows what is saved and can clear it', async () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1"
      initial={{ job_outcome: 'won', job_value_cents: 425000, collected_cents: 100000, lost_reason: null }} />);
    expect(screen.getByRole('button', { name: /won/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/sold for/i)).toHaveValue('4250');
    expect(screen.getByLabelText(/cash collected/i)).toHaveValue('1000');
    fireEvent.click(screen.getByRole('button', { name: /clear the outcome/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sentBody()).toEqual({ session_id: 's1', outcome: null });
  });

  it('says plainly when the server refused it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Not your dashboard."}', { status: 403 })));
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={EMPTY} />);
    fireEvent.click(screen.getByRole('button', { name: /lost/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not saved: Not your dashboard.'));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
