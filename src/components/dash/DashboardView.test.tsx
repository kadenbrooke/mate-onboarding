import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardView } from './DashboardView';

const noLeads: never[] = [];
const session = { id: 's1', mate_name: 'J&C Asphalt' };

describe('DashboardView', () => {
  it('renders all six zone labels plus crew and pulse', () => {
    render(<DashboardView session={session} leads={noLeads} />);
    for (const label of ['LEAD FLOW', 'CALENDAR', 'PIPELINE', 'FOLLOW-UP', 'SPEED', 'REPUTATION', 'YOUR CREW', 'SYSTEM PULSE']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('mobile nav switches views', () => {
    render(<DashboardView session={session} leads={noLeads} />);
    fireEvent.click(screen.getByRole('button', { name: /money/i }));
    expect(screen.getByTestId('view-money')).toBeInTheDocument();
  });
});
