import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopBar } from './TopBar';
import { DashEditingProvider } from '@/lib/dashEditing';

const mockPathname = vi.fn<() => string>(() => '/dash/s1');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

/** TopBar reads the shared Customize-mode context (the chip now lives in the
 *  header), so every render needs a DashEditingProvider ancestor -- same as
 *  the real dash layout provides. */
function renderTopBar(props: React.ComponentProps<typeof TopBar>) {
  return render(
    <DashEditingProvider>
      <TopBar {...props} />
    </DashEditingProvider>,
  );
}

describe('TopBar', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/dash/s1');
  });

  it('marks Dashboard active on the dash root', () => {
    renderTopBar({ sessionId: 's1', businessName: 'J&C Asphalt', logoUrl: null, openIncidents: 0 });
    const dash = screen.getByRole('link', { name: /dashboard/i });
    const leads = screen.getByRole('link', { name: /leads/i });
    expect(dash).toHaveAttribute('aria-current', 'page');
    expect(leads).not.toHaveAttribute('aria-current');
    expect(dash).toHaveAttribute('href', '/dash/s1');
    expect(leads).toHaveAttribute('href', '/dash/s1/leads');
  });

  it('flips the active pill on the leads page', () => {
    mockPathname.mockReturnValue('/dash/s1/leads');
    renderTopBar({ sessionId: 's1', businessName: 'J&C Asphalt', logoUrl: null, openIncidents: 0 });
    expect(screen.getByRole('link', { name: /leads/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /dashboard/i })).not.toHaveAttribute('aria-current');
  });

  it('defaults to the inline Auto Mate logo asset with no text wordmark', () => {
    renderTopBar({ sessionId: 's1', businessName: 'J&C Asphalt', logoUrl: null, openIncidents: 0 });
    const logo = screen.getByAltText('Auto Mate AI');
    expect(logo).toHaveAttribute('src', '/logo-inline.png');
    // The business name must not render as header text (avatar initials only)
    expect(screen.queryByText('J&C Asphalt')).toBeNull();
  });

  it('uses the tenant logo when the session brand carries one', () => {
    renderTopBar({ sessionId: 's1', businessName: 'J&C Asphalt', logoUrl: 'https://x.test/logo.png', openIncidents: 0 });
    expect(screen.getByAltText('J&C Asphalt')).toHaveAttribute('src', 'https://x.test/logo.png');
  });

  it('shows the incident badge only when incidents are open', () => {
    const { rerender } = render(
      <DashEditingProvider>
        <TopBar sessionId="s1" businessName="J&C Asphalt" logoUrl={null} openIncidents={0} />
      </DashEditingProvider>,
    );
    expect(screen.queryByTestId('incident-badge')).toBeNull();
    rerender(
      <DashEditingProvider>
        <TopBar sessionId="s1" businessName="J&C Asphalt" logoUrl={null} openIncidents={3} />
      </DashEditingProvider>,
    );
    expect(screen.getByTestId('incident-badge')).toHaveTextContent('3');
  });

  it('renders the client initials in the avatar chip', () => {
    renderTopBar({ sessionId: 's1', businessName: 'J&C Asphalt', logoUrl: null, openIncidents: 0 });
    expect(screen.getByText('JC')).toBeInTheDocument();
  });

  it('respects the notch: header top padding includes safe-area-inset-top', () => {
    renderTopBar({ sessionId: 's1', businessName: 'J&C Asphalt', logoUrl: null, openIncidents: 0 });
    const header = screen.getByRole('banner');
    // env() is applied via an embedded class rule (jsdom drops env() from
    // inline CSSOM styles): assert the rule ships with the component.
    expect(header.className).toContain('dash-topbar');
    expect(header.querySelector('style')?.textContent).toContain('safe-area-inset-top');
  });

  it('shows a Customize layout control on the dashboard root', () => {
    renderTopBar({ sessionId: 's1', businessName: 'J&C Asphalt', logoUrl: null, openIncidents: 0 });
    expect(screen.getByRole('button', { name: /customize layout/i })).toBeInTheDocument();
  });

  it('hides the Customize layout control on leads/assistant pages', () => {
    mockPathname.mockReturnValue('/dash/s1/leads');
    renderTopBar({ sessionId: 's1', businessName: 'J&C Asphalt', logoUrl: null, openIncidents: 0 });
    expect(screen.queryByRole('button', { name: /customize layout/i })).toBeNull();
  });
});
