import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComingSoon } from './ComingSoon';

describe('ComingSoon', () => {
  it('shows the badge, the zone name, and the description', () => {
    render(<ComingSoon zoneLabel="Ad performance" description="Your ad spend, once we connect it for you." />);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText('Ad performance')).toBeInTheDocument();
    expect(screen.getByText('Your ad spend, once we connect it for you.')).toBeInTheDocument();
  });

  it('renders no link, unlike MissingInfo', () => {
    render(<ComingSoon zoneLabel="Ad performance" description="d" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders no numbers, so it cannot be mistaken for a real data zone', () => {
    const { container } = render(<ComingSoon zoneLabel="Ad performance" description="No numbers here at all." />);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('never renders the red MISSING word', () => {
    render(<ComingSoon zoneLabel="Ad performance" description="d" />);
    expect(screen.queryByText(/MISSING/)).toBeNull();
  });
});
