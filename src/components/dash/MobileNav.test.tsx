import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileNav } from './MobileNav';

const mockPathname = vi.fn<() => string>(() => '/dash/s1');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

describe('MobileNav', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/dash/s1');
  });

  describe('tab mode (dashboard root, in-page views)', () => {
    it('renders all four tabs and fires onChange', () => {
      const onChange = vi.fn();
      render(<MobileNav view="home" onChange={onChange} />);
      for (const label of ['Home', 'Leads', 'Money', 'Agents']) {
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

  describe('link mode (standalone sub-pages)', () => {
    it('renders real links to the leads table and assistant page', () => {
      render(<MobileNav sessionId="s1" />);
      expect(screen.getByRole('link', { name: /leads/i })).toHaveAttribute('href', '/dash/s1/leads');
      expect(screen.getByRole('link', { name: /assistant/i })).toHaveAttribute('href', '/dash/s1/assistant');
    });

    it('routes Home, Money, and Agents back to the dashboard root (no standalone route)', () => {
      render(<MobileNav sessionId="s1" />);
      expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/dash/s1');
      expect(screen.getByRole('link', { name: 'Money' })).toHaveAttribute('href', '/dash/s1');
      expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/dash/s1');
    });

    it('marks Leads active when on the leads table route', () => {
      mockPathname.mockReturnValue('/dash/s1/leads');
      render(<MobileNav sessionId="s1" />);
      expect(screen.getByRole('link', { name: /leads/i })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('marks Assistant active when on the standalone assistant route', () => {
      mockPathname.mockReturnValue('/dash/s1/assistant');
      render(<MobileNav sessionId="s1" />);
      expect(screen.getByRole('link', { name: /assistant/i })).toHaveAttribute('aria-current', 'page');
    });
  });
});
