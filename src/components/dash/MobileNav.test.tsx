import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileNav } from './MobileNav';

describe('MobileNav', () => {
  it('renders all four tabs and fires onChange', () => {
    const onChange = vi.fn();
    render(<MobileNav view="home" onChange={onChange} />);
    for (const label of ['Home', 'Leads', 'Money', 'Crew']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Money' }));
    expect(onChange).toHaveBeenCalledWith('money');
  });

  it('marks the active tab with aria-current', () => {
    render(<MobileNav view="leads" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Leads' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('clears the iPhone home indicator via safe-area-inset-bottom padding', () => {
    render(<MobileNav view="home" onChange={() => {}} />);
    const nav = screen.getByTestId('mobile-nav');
    // env() is applied via an embedded class rule (jsdom drops env() from
    // inline CSSOM styles): assert the rule ships with the component.
    expect(nav.querySelector('style')?.textContent).toContain('safe-area-inset-bottom');
  });

  it('tab buttons meet the 44px minimum touch target', () => {
    render(<MobileNav view="home" onChange={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Home' });
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
});
