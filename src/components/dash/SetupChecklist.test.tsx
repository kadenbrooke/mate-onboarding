import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetupChecklist } from './SetupChecklist';
import { zoneLocks } from '@/lib/dash/locks';

const NOTHING = zoneLocks({
  sessionId: 's1', collected: null, agentEnabled: false, operatorPhone: null, adsPresent: false,
});
const EVERYTHING = zoneLocks({
  sessionId: 's1', collected: { google_connected: true }, agentEnabled: true,
  operatorPhone: '+18015551234', adsPresent: true,
});

describe('SetupChecklist', () => {
  it('counts connected items out of the gated total', () => {
    render(<SetupChecklist locks={NOTHING} />);
    expect(screen.getByText('0 of 5 connected')).toBeTruthy();
  });

  it('counts everything when all gates pass', () => {
    render(<SetupChecklist locks={EVERYTHING} />);
    expect(screen.getByText('5 of 5 connected')).toBeTruthy();
  });

  it('lists every gated zone by name', () => {
    render(<SetupChecklist locks={NOTHING} />);
    for (const label of ['Calendar', 'Reputation', 'Follow-up engine', 'Operations', 'Ad performance']) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
  });

  it('never shows a response-time or speed metric', () => {
    const { container } = render(<SetupChecklist locks={NOTHING} />);
    expect(container.textContent).not.toMatch(/response|speed|streak|seconds/i);
  });

  it('shows no percentage or score, because setup is not a performance metric', () => {
    const { container } = render(<SetupChecklist locks={NOTHING} />);
    expect(container.textContent).not.toContain('%');
  });
});
