import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrewRoster } from './CrewRoster';
import { AgentActivity } from './AgentActivity';

describe('CrewRoster', () => {
  it('renders a plain-language name for known agent keys, overriding whatever label the backend sent', () => {
    render(<CrewRoster capabilities={[
      { key: 'first_responder', label: 'First Responder', status: 'live' },
      { key: 'gbp_reviews', label: 'Reputation Builder', status: 'under_construction' },
    ]} />);
    // Known key: AGENT_LABELS wins over the raw backend label.
    expect(screen.getByText('Lead Response')).toBeInTheDocument();
    expect(screen.queryByText('First Responder')).toBeNull();
    // Unknown key: falls back to whatever label was provided.
    expect(screen.getByText('Reputation Builder')).toBeInTheDocument();
    expect(screen.getByText('● LIVE')).toBeInTheDocument();
    expect(screen.getByText('LOCKED')).toBeInTheDocument();
  });
  it('renders default roster when no capabilities', () => {
    render(<CrewRoster capabilities={[]} />);
    expect(screen.getByText(/your crew assembles/i)).toBeInTheDocument();
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
