import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrewRoster } from './CrewRoster';

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
