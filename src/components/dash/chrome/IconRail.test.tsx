import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { IconRail } from './IconRail';

const mockPathname = vi.fn<() => string>(() => '/dash/s1');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

describe('IconRail', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/dash/s1');
  });

  it('renders one chip per dashboard zone', () => {
    render(<IconRail />);
    for (const label of ['Lead flow', 'Speed to lead', 'Follow-up engine', 'Reputation', 'Calendar']) {
      expect(screen.getByRole('button', { name: `Scroll to ${label}` })).toBeInTheDocument();
    }
  });

  it('does not render on the leads page (no scroll targets there)', () => {
    mockPathname.mockReturnValue('/dash/s1/leads');
    const { container } = render(<IconRail />);
    expect(container.firstChild).toBeNull();
  });

  it('smooth-scrolls to the zone anchor on click', () => {
    render(<IconRail />);
    const target = document.createElement('div');
    target.id = 'zone-speed';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to Speed to lead' }));
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    target.remove();
  });
});
