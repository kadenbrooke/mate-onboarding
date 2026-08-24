import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Ticker } from './Ticker';
import type { ClientEvent } from '@/lib/metrics/events';

let seq = 0;
const ev = (message: string, o: Partial<ClientEvent> = {}): ClientEvent => ({
  id: `e${seq++}`,
  agent: 'first_responder',
  kind: 'reply',
  message,
  created_at: o.created_at ?? new Date().toISOString(),
  source_key: o.source_key,
  ...o,
});

const sms = (phone: string, at: string, msg: string) =>
  ev(msg, { source_key: `jcsms:${phone}:out:${at}`, created_at: at });

/** Chip messages in DOM order, i.e. left to right on the strip. */
const chipOrder = () =>
  within(screen.getByTestId('ticker-track'))
    .getAllByText(/./, { selector: '.ticker-chip' })
    .map(el => el.textContent ?? '');

describe('Ticker', () => {
  it('renders each event once, not the old doubled marquee list', () => {
    render(<Ticker events={[ev('Mike texted back in 5s'), ev('New review from Dana')]} />);
    expect(screen.getAllByText(/Mike texted back in 5s/)).toHaveLength(1);
  });

  it('renders nothing when no events', () => {
    const { container } = render(<Ticker events={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('orders newest to oldest, left to right', () => {
    render(<Ticker events={[
      sms('+15550000002', '2026-08-22T10:00:00.000Z', 'Texted Bea back'),
      sms('+15550000003', '2026-08-21T10:00:00.000Z', 'Texted Cy back'),
      sms('+15550000001', '2026-08-23T10:00:00.000Z', 'Texted Ann back'),
    ]} />);
    const order = chipOrder();
    expect(order[0]).toContain('Ann');
    expect(order[1]).toContain('Bea');
    expect(order[2]).toContain('Cy');
  });

  it('rolls repeat activity for one lead into a single counted chip', () => {
    render(<Ticker events={[
      sms('+16128198700', '2026-08-21T23:07:00.000Z', 'Texted Ashish Garg back'),
      sms('+16128198700', '2026-08-21T22:00:00.000Z', 'Texted Ashish Garg back'),
      sms('+16128198700', '2026-08-21T21:20:00.000Z', 'Texted Ashish Garg back'),
    ]} />);
    expect(screen.getAllByText(/Texted Ashish Garg back/)).toHaveLength(1);
    expect(screen.getByTestId('ticker-count-phone:+16128198700')).toHaveTextContent('3');
  });

  it('a re-texted lead moves to the front instead of appearing twice', () => {
    // Ann is oldest, so without the re-text she would sit last.
    render(<Ticker events={[
      sms('+15550000001', '2026-08-20T10:00:00.000Z', 'Texted Ann back'),
      sms('+15550000002', '2026-08-21T10:00:00.000Z', 'Texted Bea back'),
      sms('+15550000003', '2026-08-22T10:00:00.000Z', 'Texted Cy back'),
      // Ann again, newest of all.
      sms('+15550000001', '2026-08-23T10:00:00.000Z', 'Texted Ann back'),
    ]} />);
    const order = chipOrder();
    expect(order[0]).toContain('Ann');
    expect(order.filter(t => t.includes('Ann'))).toHaveLength(1);
    expect(order).toHaveLength(3);
  });

  it('does not roll together distinct leads', () => {
    render(<Ticker events={[
      sms('+15550000001', '2026-08-23T10:00:00.000Z', 'Texted Ann back'),
      sms('+15550000002', '2026-08-22T10:00:00.000Z', 'Texted Bea back'),
    ]} />);
    expect(chipOrder()).toHaveLength(2);
  });

  it('keeps call and quote events separate rather than guessing their lead', () => {
    // postcall rows carry no lead reference in source_key, so each stands alone.
    render(<Ticker events={[
      ev('Checked in after your call with Ann', {
        source_key: 'postcall:aaa:opened', created_at: '2026-08-23T10:00:00.000Z',
      }),
      ev('Sent Ann the onboarding form', {
        source_key: 'postcall:bbb:resolved', created_at: '2026-08-23T09:00:00.000Z',
      }),
    ]} />);
    expect(chipOrder()).toHaveLength(2);
  });

  it('does not animate the strip on first paint', () => {
    const { container } = render(<Ticker events={[ev('Texted Ann back')]} />);
    expect(container.querySelectorAll('.ticker-chip-enter')).toHaveLength(0);
  });
});
