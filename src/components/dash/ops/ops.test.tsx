import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrewRoster } from './CrewRoster';
import { SystemPulse } from './SystemPulse';

describe('CrewRoster', () => {
  it('renders live and locked agents', () => {
    render(<CrewRoster capabilities={[
      { key: 'first_responder', label: 'First Responder', status: 'live' },
      { key: 'gbp_reviews', label: 'Reputation Builder', status: 'under_construction' },
    ]} />);
    expect(screen.getByText('First Responder')).toBeInTheDocument();
    expect(screen.getByText('● LIVE')).toBeInTheDocument();
    expect(screen.getByText('LOCKED')).toBeInTheDocument();
  });
  it('renders default roster when no capabilities', () => {
    render(<CrewRoster capabilities={[]} />);
    expect(screen.getByText(/your crew assembles/i)).toBeInTheDocument();
  });
});

describe('SystemPulse', () => {
  it('green state when no incidents', () => {
    render(<SystemPulse incidents={[]} />);
    expect(screen.getByText('ALL SYSTEMS GO')).toBeInTheDocument();
  });
  it('critical state with stopwatch when critical incident open', () => {
    render(<SystemPulse incidents={[{
      id: 'i1', severity: 'critical', message: 'Incoming texts not being answered',
      started_at: new Date(Date.now() - 60_000).toISOString(), resolved_at: null,
    }]} />);
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByText(/your support team was notified/i)).toBeInTheDocument();
    expect(screen.getByTestId('downtime')).toBeInTheDocument();
  });
  it('warning state', () => {
    render(<SystemPulse incidents={[{
      id: 'i2', severity: 'warning', message: 'Text credit balance low',
      started_at: new Date().toISOString(), resolved_at: null,
    }]} />);
    expect(screen.getByText('NEEDS ATTENTION')).toBeInTheDocument();
  });
});
