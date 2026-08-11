import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrewRoster } from './CrewRoster';
import { AgentActivity } from './AgentActivity';

describe('CrewRoster', () => {
  it('always lists all five product agents by their real names', () => {
    render(<CrewRoster capabilities={[]} />);
    for (const name of ['First Responder', 'Cultivator', 'Command Center', 'Reactivator', 'Reputation Builder']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('shows Command Center live for every client, with no capability row', () => {
    render(<CrewRoster capabilities={[]} />);
    expect(screen.getByTestId('crew-row-command_center')).toHaveAttribute('data-live', 'true');
  });

  it("renders J&C's roster: FR, Cultivator and Command Center live, the rest locked", () => {
    render(<CrewRoster capabilities={[
      // Legacy alias for First Responder, plus a live Cultivator row.
      { key: 'first_responder_sms', label: 'Missed-call text-back', status: 'live' },
      { key: 'cultivator', label: 'Quote follow-up', status: 'live' },
      { key: 'gbp_reviews', label: 'Google reviews', status: 'under_construction' },
    ]} />);
    expect(screen.getByTestId('crew-row-first_responder')).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('crew-row-cultivator')).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('crew-row-command_center')).toHaveAttribute('data-live', 'true');
    // No row at all, and a non-live row, both read LOCKED.
    expect(screen.getByTestId('crew-row-reactivator')).toHaveAttribute('data-live', 'false');
    expect(screen.getByTestId('crew-row-reputation_builder')).toHaveAttribute('data-live', 'false');
    // The 3 LIVE pills are the same 3 the AGENTS ACTIVE tile counts.
    expect(screen.getAllByText('● LIVE')).toHaveLength(3);
    expect(screen.getAllByText('LOCKED')).toHaveLength(2);
  });

  it('never claims a capability-backed agent is live without a row', () => {
    render(<CrewRoster capabilities={[]} />);
    // Only Command Center, which is live by definition.
    expect(screen.getAllByText('● LIVE')).toHaveLength(1);
    expect(screen.getAllByText('LOCKED')).toHaveLength(4);
  });
});

describe('AgentActivity', () => {
  it('ranks agents by action count within the last 30 days', () => {
    const now = new Date().toISOString();
    render(<AgentActivity events={[
      { id: '1', agent: 'first_responder', kind: 'x', message: '', created_at: now },
      { id: '2', agent: 'first_responder', kind: 'x', message: '', created_at: now },
      { id: '3', agent: 'reactivator', kind: 'x', message: '', created_at: now },
    ]} />);
    expect(screen.getByText('AGENT ACTIVITY')).toBeInTheDocument();
    // Plain-language names (match automateutah.com), kept short so they
    // don't clip in the bar chart's fixed-width label column.
    expect(screen.getByText('Lead Response')).toBeInTheDocument();
    expect(screen.getByText('Win-Back')).toBeInTheDocument();
    expect(screen.getByTestId('agent-bar-first_responder')).toBeInTheDocument();
  });

  it('renders an empty state with no agent events', () => {
    render(<AgentActivity events={[]} />);
    expect(screen.getByText(/no agent actions yet/i)).toBeInTheDocument();
  });
});
