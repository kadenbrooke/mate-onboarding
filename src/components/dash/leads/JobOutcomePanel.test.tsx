import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JobOutcomePanel, dollars, type OutcomeFields, type PanelPayment } from './JobOutcomePanel';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));

// Invented practice numbers only.
const EMPTY: OutcomeFields = { job_outcome: null, job_value_cents: null, lost_reason: null };
const WON: OutcomeFields = { job_outcome: 'won', job_value_cents: 600000, lost_reason: null };
const PAID: PanelPayment[] = [
  { id: 'p1', amount_cents: 500000, paid_at: '2026-08-01T18:00:00.000Z' },
  { id: 'p2', amount_cents: 100000, paid_at: '2026-10-01T18:00:00.000Z' },
];

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;
const lastCall = () => fetchMock().mock.calls.at(-1)!;
const sentBody = () => JSON.parse(String(lastCall()[1].body));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
  refreshMock.mockClear();
});

describe('JobOutcomePanel', () => {
  it('records a won job with its sold price, in cents', async () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={EMPTY} payments={[]} />);
    expect(screen.queryByLabelText(/sold for/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /won/i }));
    fireEvent.change(screen.getByLabelText(/sold for/i), { target: { value: '$4,250.50' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved as won.'));
    expect(lastCall()[0]).toBe('/api/leads/l1/outcome');
    expect(sentBody()).toEqual({ session_id: 's1', outcome: 'won', job_value_cents: 425050 });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('only offers payments once the job is saved as won', () => {
    const { unmount } = render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={EMPTY} payments={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /won/i }));
    expect(screen.queryByTestId('job-payments')).toBeNull();
    unmount();
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={[]} />);
    expect(screen.getByTestId('job-payments-total').textContent).toBe('$0');
  });

  it('shows each payment and the running total', () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={PAID} />);
    expect(screen.getAllByTestId('job-payment')).toHaveLength(2);
    expect(screen.getByTestId('job-payments-total').textContent).toBe('$6,000');
  });

  it('adds a payment for today as "now", with the number keypad', async () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={PAID} />);
    const box = screen.getByLabelText(/payment amount/i);
    expect(box).toHaveAttribute('inputmode', 'decimal');
    fireEvent.change(box, { target: { value: '1,000' } });
    fireEvent.click(screen.getByRole('button', { name: /add payment/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Payment recorded.'));
    expect(lastCall()[0]).toBe('/api/leads/l1/payments');
    expect(lastCall()[1].method).toBe('POST');
    expect(sentBody()).toEqual({ session_id: 's1', amount_cents: 100000 });
    expect(screen.getByLabelText(/payment amount/i)).toHaveValue('');
  });

  it('adds an earlier-dated payment at noon that day, and a refund as a negative amount', async () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={PAID} />);
    fireEvent.change(screen.getByLabelText(/date received/i), { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /refund/i }));
    fireEvent.change(screen.getByLabelText(/refund amount/i), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /add refund/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      session_id: 's1', amount_cents: -25000, paid_at: new Date('2026-09-15T12:00:00').toISOString(),
    });
  });

  it('refuses an amount it cannot read, without calling the server', () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={[]} />);
    fireEvent.change(screen.getByLabelText(/payment amount/i), { target: { value: 'two grand' } });
    fireEvent.click(screen.getByRole('button', { name: /add payment/i }));
    expect(screen.getByRole('status').textContent).toMatch(/amount/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes a payment by id, scoped to the session', async () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={PAID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove payment of $1,000' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastCall()[0]).toBe('/api/leads/l1/payments/p2?session_id=s1');
    expect(lastCall()[1].method).toBe('DELETE');
  });

  it('will not un-win a job with payments: Lost is disabled and Clear is replaced by a hint', () => {
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={PAID} />);
    expect(screen.getByRole('button', { name: /lost/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /clear the outcome/i })).toBeNull();
    expect(screen.getByText(/remove its payments first/i)).toBeTruthy();
  });

  it('records a lost job with an optional reason, and clears an unpaid outcome', async () => {
    const { unmount } = render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={EMPTY} payments={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /lost/i }));
    fireEvent.change(screen.getByLabelText(/why was it lost/i), { target: { value: 'cheaper bid' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sentBody()).toEqual({ session_id: 's1', outcome: 'lost', lost_reason: 'cheaper bid' });
    unmount();
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /clear the outcome/i }));
    await waitFor(() => expect(fetchMock().mock.calls).toHaveLength(2));
    expect(sentBody()).toEqual({ session_id: 's1', outcome: null });
  });

  it('says plainly when the server refused it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Mark the job won before recording a payment."}', { status: 409 })));
    render(<JobOutcomePanel leadId="l1" sessionId="s1" initial={WON} payments={[]} />);
    fireEvent.change(screen.getByLabelText(/payment amount/i), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /add payment/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not saved: Mark the job won before recording a payment.'));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('formats dollars with cents only when there are cents', () => {
    expect(dollars(425000)).toBe('$4,250');
    expect(dollars(425050)).toBe('$4,250.50');
    expect(dollars(-2500)).toBe('-$25');
  });
});
