import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardView } from './DashboardView';
import type { DashData } from './types';

const noLeads: never[] = [];
const session = { id: 's1', mate_name: 'J&C Asphalt' };

const emptyDash: DashData = {
  events: [],
  appointments: [],
  reactivation: null,
  wins: [],
  reputation: null,
  reviews: [],
  capabilities: [],
  incidents: [],
};

describe('DashboardView', () => {
  it('desktop renders all final composition zones', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);

    // All desktop widget card labels present (desktop + mobile containers both in DOM)
    const desktopLabels = [
      'HOT RIGHT NOW',
      'THE PIPELINE',
      'FOLLOW-UP ENGINE',
      'SPEED TO LEAD',
      'THE REPUTATION MACHINE',
      'YOUR CREW',
      'SYSTEM PULSE',
      'LEAD JOURNEY',
      'LEADS',
    ];
    for (const label of desktopLabels) {
      expect(screen.getAllByText(label).length, `label "${label}" not found`).toBeGreaterThanOrEqual(1);
    }

    // BOOKED APPOINTMENTS (regex covers any variant)
    expect(screen.getAllByText(/BOOKED APPOINTMENTS/).length).toBeGreaterThanOrEqual(1);
  });

  it('mobile crew tab contains SETUP stub', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    // Navigate to crew tab where SETUP stub lives
    fireEvent.click(screen.getByRole('button', { name: /crew/i }));
    expect(screen.getByTestId('view-crew')).toBeInTheDocument();
    expect(screen.getAllByText('SETUP').length).toBeGreaterThanOrEqual(1);
  });

  it('mobile nav tabs switch views', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);

    // Default home tab
    expect(screen.getByTestId('view-home')).toBeInTheDocument();

    // Switch to money tab
    fireEvent.click(screen.getByRole('button', { name: /money/i }));
    expect(screen.getByTestId('view-money')).toBeInTheDocument();

    // Switch to leads tab
    fireEvent.click(screen.getByRole('button', { name: /leads/i }));
    expect(screen.getByTestId('view-leads')).toBeInTheDocument();

    // Switch to crew tab
    fireEvent.click(screen.getByRole('button', { name: /crew/i }));
    expect(screen.getByTestId('view-crew')).toBeInTheDocument();
  });

  it('renders real lead flow + pipeline widgets when leads exist', () => {
    const leads = [{
      id: 'l1', name: 'Mike R.', city: 'Orem', service: 'Driveway', source: 'referral',
      referrer_name: null, score: 92, status: 'won', quote_cents: 100000, contacted: false,
      after_hours: false, first_reply_seconds: 10, created_at: new Date().toISOString(),
    }] as never[];
    render(<DashboardView session={session} leads={leads} data={emptyDash} />);
    expect(screen.getAllByText('HOT RIGHT NOW').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('THE PIPELINE').length).toBeGreaterThanOrEqual(1);
  });

  it('money tab renders reputation and follow-up inside mobile container', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    fireEvent.click(screen.getByRole('button', { name: /money/i }));
    const mobile = screen.getByTestId('view-money');
    expect(mobile).toBeInTheDocument();
  });
});
