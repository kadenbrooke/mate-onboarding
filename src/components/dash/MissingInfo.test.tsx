import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MissingInfo } from './MissingInfo';

describe('MissingInfo', () => {
  it('shows the alert, the zone name and the reason', () => {
    render(<MissingInfo zoneLabel="Calendar" reason="We need your Google account." />);
    expect(screen.getByText(/MISSING/)).toBeTruthy();
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByText('We need your Google account.')).toBeTruthy();
  });

  it('renders the cta as a link to its href', () => {
    render(
      <MissingInfo
        zoneLabel="Calendar"
        reason="r"
        cta={{ label: 'Connect Google', href: '/api/connect/google?sessionId=s1' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Connect Google' });
    expect(link.getAttribute('href')).toBe('/api/connect/google?sessionId=s1');
  });

  it('renders no link when there is no cta', () => {
    render(<MissingInfo zoneLabel="Calendar" reason="r" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders no numbers, so a locked zone cannot be mistaken for real data', () => {
    const { container } = render(<MissingInfo zoneLabel="Ad performance" reason="Not linked yet." />);
    expect(container.textContent).not.toMatch(/\d/);
  });
});
