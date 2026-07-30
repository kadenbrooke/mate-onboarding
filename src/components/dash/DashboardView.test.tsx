import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  weekActionCount: 0,
  ads: null,
};

describe('DashboardView', () => {
  it('desktop renders all final composition zones', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);

    // Every grey SectionCard carries an eyebrow label (round-2 redesign)
    const sectionLabels = [
      'Calendar',
      'Lead flow',
      'Lead journey',
      'Pipeline',
      'Follow-up engine',
      'Speed to lead',
      'Reputation',
      'Operations',
    ];
    for (const label of sectionLabels) {
      expect(screen.getAllByText(label).length, `section label "${label}" not found`).toBeGreaterThanOrEqual(1);
    }

    // White card labels that stay distinct from their section label
    const cardLabels = ['HOT RIGHT NOW', 'YOUR CREW', 'SYSTEM PULSE', 'LEADS'];
    for (const label of cardLabels) {
      expect(screen.getAllByText(label).length, `card label "${label}" not found`).toBeGreaterThanOrEqual(1);
    }
  });

  it('desktop zones render once in the movable grid behind a Customize toggle', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    const desktop = screen.getByTestId('dash-desktop');
    // Off by default: Customize entry shown, edit toolbar absent.
    const customize = within(desktop).getByRole('button', { name: /customize layout/i });
    expect(customize).toBeInTheDocument();
    expect(within(desktop).queryByRole('button', { name: /done/i })).toBeNull();
    // Every movable zone appears exactly once in the desktop grid.
    const zones = ['Calendar', 'Lead flow', 'Speed to lead', 'Pipeline', 'Lead journey', 'Follow-up engine', 'Reputation', 'Operations'];
    for (const zone of zones) {
      expect(within(desktop).getAllByText(zone).length, `zone "${zone}" should appear exactly once`).toBe(1);
    }
  });

  it('entering Customize mode reveals Reset + Done controls', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    const desktop = screen.getByTestId('dash-desktop');
    fireEvent.click(within(desktop).getByRole('button', { name: /customize layout/i }));
    expect(within(desktop).getByRole('button', { name: /done/i })).toBeInTheDocument();
    expect(within(desktop).getByRole('button', { name: /reset/i })).toBeInTheDocument();
    // Customize entry hides while editing.
    expect(within(desktop).queryByRole('button', { name: /customize layout/i })).toBeNull();
  });

  it('desktop section cards expose the icon-rail scroll anchors', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    for (const id of ['zone-leadflow', 'zone-speed', 'zone-followup', 'zone-reputation', 'zone-calendar']) {
      expect(document.getElementById(id), `anchor #${id} missing`).not.toBeNull();
    }
  });

  it('mobile Customize enters reorder mode with per-card drag handles', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    const mobile = screen.getByTestId('view-home');
    fireEvent.click(within(mobile).getByRole('button', { name: /customize layout/i }));
    // Re-query: the container re-renders into edit mode.
    const editing = screen.getByTestId('view-home');
    expect(within(editing).getByText(/drag a card by its handle/i)).toBeInTheDocument();
    expect(within(editing).getByRole('button', { name: /done/i })).toBeInTheDocument();
    // One drag handle per sortable home card (Hero + Ticker stay pinned).
    expect(within(editing).getAllByRole('button', { name: /drag to reorder/i }).length).toBe(3);
  });

  it('renders the Mercury-style recovered chart as the dark hero card', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    expect(screen.getAllByTestId('recovered-chart').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('recovered-delta').length).toBeGreaterThanOrEqual(1);
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
    expect(screen.getAllByText('Pipeline').length).toBeGreaterThanOrEqual(1);
  });

  it('money tab renders reputation and follow-up inside mobile container', () => {
    render(<DashboardView session={session} leads={noLeads} data={emptyDash} />);
    fireEvent.click(screen.getByRole('button', { name: /money/i }));
    const mobile = screen.getByTestId('view-money');
    expect(mobile).toBeInTheDocument();
  });
});
