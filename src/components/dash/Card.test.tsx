import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Card, SectionCard } from './Card';

describe('Card', () => {
  it('renders label and children', () => {
    render(<Card label="THE PIPELINE"><span>body</span></Card>);
    expect(screen.getByText('THE PIPELINE')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});

describe('Card star mode toggle', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('star flips the card between light and dark --card-* vars', () => {
    const { container } = render(<Card label="THE PIPELINE"><span>body</span></Card>);
    const card = container.querySelector('section')!;
    expect(card.getAttribute('data-card-mode')).toBe('light');
    expect(card.style.getPropertyValue('--card-bg')).toBe('#ffffff');
    expect(card.style.getPropertyValue('--card-fg')).toBe('#141414');

    const star = screen.getByRole('button', { name: /switch card to dark mode/i });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);

    expect(card.getAttribute('data-card-mode')).toBe('dark');
    expect(card.style.getPropertyValue('--card-bg')).toBe('#1d1d1d');
    expect(card.style.getPropertyValue('--card-fg')).toBe('#ede6e6');
    expect(screen.getByRole('button', { name: /switch card to light mode/i }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('persists the chosen mode per card in localStorage', () => {
    render(<Card label="THE PIPELINE"><span>body</span></Card>);
    fireEvent.click(screen.getByRole('button', { name: /dark mode/i }));
    expect(window.localStorage.getItem('mate-card-theme:the-pipeline')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /light mode/i }));
    expect(window.localStorage.getItem('mate-card-theme:the-pipeline')).toBe('light');
  });

  it('restores a persisted dark mode on mount (SSR-safe effect read)', async () => {
    window.localStorage.setItem('mate-card-theme:leads', 'dark');
    const { container } = render(<Card label="LEADS"><span>body</span></Card>);
    await waitFor(() => {
      expect(container.querySelector('section')!.getAttribute('data-card-mode')).toBe('dark');
    });
  });

  it('prefers an explicit themeKey over the label slug (month-dependent labels)', () => {
    render(<Card label="JULY BOOKED APPOINTMENTS" themeKey="calendar"><span>body</span></Card>);
    fireEvent.click(screen.getByRole('button', { name: /dark mode/i }));
    expect(window.localStorage.getItem('mate-card-theme:calendar')).toBe('dark');
    expect(window.localStorage.getItem('mate-card-theme:july-booked-appointments')).toBeNull();
  });
});

describe('SectionCard', () => {
  it('renders title and children', () => {
    render(<SectionCard title="Lead flow"><span>inner</span></SectionCard>);
    expect(screen.getByText('Lead flow')).toBeInTheDocument();
    expect(screen.getByText('inner')).toBeInTheDocument();
  });
  it('renders children without a title', () => {
    render(<SectionCard><span>bare</span></SectionCard>);
    expect(screen.getByText('bare')).toBeInTheDocument();
  });

  it('renders the MISSING INFO body when locked', () => {
    render(
      <SectionCard title="Calendar" locked={{ zoneLabel: 'Calendar', reason: 'Connect Google first.' }}>
        <p>real content</p>
      </SectionCard>,
    );
    expect(screen.getByText(/MISSING/)).toBeInTheDocument();
    expect(screen.getByText('Connect Google first.')).toBeInTheDocument();
  });

  it('does not render children into the tree at all when locked (data-exposure guard)', () => {
    const { container } = render(
      <SectionCard title="Calendar" locked={{ zoneLabel: 'Calendar', reason: 'r' }}>
        <p data-testid="secret">$18,400 recovered</p>
      </SectionCard>,
    );
    expect(screen.queryByTestId('secret')).toBeNull();
    expect(container.textContent).not.toContain('18,400');
  });

  it('keeps its id so the icon rail can still scroll to a locked zone', () => {
    const { container } = render(
      <SectionCard id="zone-calendar" title="Calendar" locked={{ zoneLabel: 'Calendar', reason: 'r' }}>
        <p>x</p>
      </SectionCard>,
    );
    expect(container.querySelector('#zone-calendar')).toBeTruthy();
  });

  it('renders the cta link when the lock carries one', () => {
    render(
      <SectionCard
        title="Calendar"
        locked={{ zoneLabel: 'Calendar', reason: 'r', cta: { label: 'Connect Google', href: '/api/connect/google?sessionId=s1' } }}
      >
        <p>x</p>
      </SectionCard>,
    );
    expect(screen.getByRole('link', { name: 'Connect Google' }).getAttribute('href'))
      .toBe('/api/connect/google?sessionId=s1');
  });
});
