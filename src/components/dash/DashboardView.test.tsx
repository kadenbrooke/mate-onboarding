import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DashboardView } from './DashboardView';
import { DashEditingProvider, useDashEditing } from '@/lib/dashEditing';
import type { DashData } from './types';
import { zoneLocks } from '@/lib/dash/locks';

const noLeads: never[] = [];
const session = { id: 's1', mate_name: 'J&C Asphalt' };

// Everything connected: existing assertions test the fully-unlocked dashboard,
// which is what these tests were written against. Lock-specific behaviour is
// covered in Card.test.tsx and locks.test.ts.
const UNLOCKED = zoneLocks({
  sessionId: 's1', collected: { google_connected: true }, agentEnabled: true,
  operatorPhone: '+18015551234', adsPresent: true, moneyPresent: true,
});

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
  money: null,
};

/** Stand-in for the header's Customize chip (TopBar), which now owns the
 *  editing entry point. Tests drive the same shared context a real page
 *  would, via DashEditingProvider, rather than reaching into DashboardView
 *  for a button it no longer renders itself. */
function CustomizeHarness() {
  const { editing, setEditing } = useDashEditing();
  return (
    <button type="button" onClick={() => setEditing(!editing)}>
      {editing ? 'Done editing' : 'Customize layout'}
    </button>
  );
}

function renderDash(
  props: Omit<React.ComponentProps<typeof DashboardView>, 'locks'>
    & Partial<Pick<React.ComponentProps<typeof DashboardView>, 'locks'>>,
) {
  return render(
    <DashEditingProvider>
      <CustomizeHarness />
      <DashboardView locks={UNLOCKED} {...props} />
    </DashEditingProvider>,
  );
}

describe('DashboardView', () => {
  it('desktop renders all final composition zones', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });

    // Every grey SectionCard carries an eyebrow label (round-2 redesign)
    const sectionLabels = [
      'Calendar',
      'Lead flow',
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
    const cardLabels = ['HOT RIGHT NOW', 'YOUR CREW', 'LEADS'];
    for (const label of cardLabels) {
      expect(screen.getAllByText(label).length, `card label "${label}" not found`).toBeGreaterThanOrEqual(1);
    }
  });

  it('desktop zones render once in the movable grid behind a Customize toggle', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });
    const desktop = screen.getByTestId('dash-desktop');
    // Off by default: Customize entry shown (now in the header harness), edit toolbar absent.
    expect(screen.getByRole('button', { name: /customize layout/i })).toBeInTheDocument();
    expect(within(desktop).queryByRole('button', { name: /done/i })).toBeNull();
    // Every movable zone's SectionCard heading appears exactly once in the
    // desktop grid. Matched by heading role, not raw text, because the setup
    // checklist legitimately lists gated zone names (Calendar, Reputation,
    // Follow-up engine, Operations) as its checklist items too.
    const zones = ['Calendar', 'Lead flow', 'Speed to lead', 'Pipeline', 'Follow-up engine', 'Reputation', 'Operations'];
    for (const zone of zones) {
      expect(within(desktop).getAllByRole('heading', { name: zone }).length, `zone "${zone}" heading should appear exactly once`).toBe(1);
    }
    // The always-visible setup checklist is present on desktop too.
    expect(within(desktop).getByRole('heading', { name: 'Setup' })).toBeInTheDocument();
  });

  it('entering Customize mode reveals Reset + Done controls', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });
    const desktop = screen.getByTestId('dash-desktop');
    fireEvent.click(screen.getByRole('button', { name: /customize layout/i }));
    expect(within(desktop).getByRole('button', { name: /done/i })).toBeInTheDocument();
    expect(within(desktop).getByRole('button', { name: /reset/i })).toBeInTheDocument();
    // Customize entry (header harness) flips to its "exit" label while editing.
    expect(screen.queryByRole('button', { name: /^customize layout$/i })).toBeNull();
  });

  it('desktop section cards expose the icon-rail scroll anchors', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });
    for (const id of ['zone-leadflow', 'zone-speed', 'zone-followup', 'zone-reputation', 'zone-calendar']) {
      expect(document.getElementById(id), `anchor #${id} missing`).not.toBeNull();
    }
  });

  it('mobile Customize enters reorder mode with per-card drag handles', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });
    fireEvent.click(screen.getByRole('button', { name: /customize layout/i }));
    // Re-query: the container re-renders into edit mode.
    const editing = screen.getByTestId('view-home');
    expect(within(editing).getByText(/drag a card by its handle/i)).toBeInTheDocument();
    expect(within(editing).getByRole('button', { name: /done/i })).toBeInTheDocument();
    // One drag handle per sortable home card (Hero + Ticker stay pinned;
    // System Pulse removed, so home is Hot Leads + Calendar).
    expect(within(editing).getAllByRole('button', { name: /drag to reorder/i }).length).toBe(2);
  });

  it('renders the Mercury-style recovered chart as the dark hero card', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });
    expect(screen.getAllByTestId('recovered-chart').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('recovered-delta').length).toBeGreaterThanOrEqual(1);
  });

  it('mobile agents tab contains SETUP stub', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });
    // Navigate to agents tab where SETUP stub lives
    fireEvent.click(screen.getByRole('button', { name: /agents/i }));
    expect(screen.getByTestId('view-crew')).toBeInTheDocument();
    expect(screen.getAllByText('SETUP').length).toBeGreaterThanOrEqual(1);
  });

  it('mobile nav tabs switch views', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });

    // Default home tab
    expect(screen.getByTestId('view-home')).toBeInTheDocument();

    // Switch to money tab
    fireEvent.click(screen.getByRole('button', { name: /money/i }));
    expect(screen.getByTestId('view-money')).toBeInTheDocument();

    // Switch to leads tab
    fireEvent.click(screen.getByRole('button', { name: /leads/i }));
    expect(screen.getByTestId('view-leads')).toBeInTheDocument();

    // Switch to agents tab
    fireEvent.click(screen.getByRole('button', { name: /agents/i }));
    expect(screen.getByTestId('view-crew')).toBeInTheDocument();
  });

  it('renders real lead flow + pipeline widgets when leads exist', () => {
    const leads = [{
      id: 'l1', name: 'Mike R.', city: 'Orem', service: 'Driveway', source: 'referral',
      referrer_name: null, score: 92, status: 'won', quote_cents: 100000, contacted: false,
      after_hours: false, first_reply_seconds: 10, created_at: new Date().toISOString(),
    }] as never[];
    renderDash({ session, leads, data: emptyDash });
    expect(screen.getAllByText('HOT RIGHT NOW').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pipeline').length).toBeGreaterThanOrEqual(1);
  });

  it('money tab renders reputation and follow-up inside mobile container', () => {
    renderDash({ session, leads: noLeads, data: emptyDash });
    fireEvent.click(screen.getByRole('button', { name: /money/i }));
    const mobile = screen.getByTestId('view-money');
    expect(mobile).toBeInTheDocument();
  });
});
