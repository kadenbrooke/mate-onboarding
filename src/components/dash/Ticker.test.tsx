import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Ticker } from './Ticker';
import type { ClientEvent } from '@/lib/metrics/events';

const ev = (message: string): ClientEvent => ({
  id: Math.random().toString(), agent: 'first_responder', kind: 'reply',
  message, created_at: new Date().toISOString(),
});

describe('Ticker', () => {
  it('renders event messages', () => {
    render(<Ticker events={[ev('Mike texted back in 5s'), ev('New review from Dana')]} />);
    // doubled list for seamless loop -- use getAllByText
    expect(screen.getAllByText(/Mike texted back in 5s/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing when no events', () => {
    const { container } = render(<Ticker events={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
