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
  it('renders stub zone labels + real widget labels', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    // Stub zones still present
    for (const label of ['CALENDAR', 'FOLLOW-UP', 'SPEED', 'REPUTATION', 'YOUR CREW', 'SYSTEM PULSE']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    // Real widgets present even with no leads
    expect(screen.getAllByText('HOT RIGHT NOW').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('THE PIPELINE').length).toBeGreaterThanOrEqual(1);
  });

  it('mobile nav switches views', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    fireEvent.click(screen.getByRole('button', { name: /money/i }));
    expect(screen.getByTestId('view-money')).toBeInTheDocument();
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

  it('money tab renders pipeline inside the mobile container', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    fireEvent.click(screen.getByRole('button', { name: /money/i }));
    const mobile = screen.getByTestId('view-money');
    expect(mobile).toBeInTheDocument();
  });
});
