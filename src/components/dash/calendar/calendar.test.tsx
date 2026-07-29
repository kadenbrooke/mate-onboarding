import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookedCalendar } from './BookedCalendar';
import type { Appointment } from '@/lib/metrics/calendar';

const appt = (dayOffset: number): Appointment => {
  const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(17, 0, 0, 0);
  return { id: Math.random().toString(), customer_name: 'Mike R.', service: 'Driveway',
    price_cents: 400000, starts_at: d.toISOString() };
};

describe('BookedCalendar', () => {
  it('renders month label, booked count and dollar total', () => {
    render(<BookedCalendar appointments={[appt(0), appt(1)]} />);
    expect(screen.getByText(/BOOKED APPOINTMENTS/)).toBeInTheDocument();
    expect(screen.getByText(/2 booked/)).toBeInTheDocument();
    expect(screen.getByText(/on the books/)).toBeInTheDocument();
  });

  it('renders locked note when empty', () => {
    render(<BookedCalendar appointments={[]} />);
    expect(screen.getByText(/appointments your agents book will land here/i)).toBeInTheDocument();
  });
});

describe('BookedCalendar appointment popover', () => {
  it('day cells are square (aspect-ratio 1/1)', () => {
    const { container } = render(<BookedCalendar appointments={[appt(0)]} />);
    const cell = Array.from(container.querySelectorAll('div')).find(
      d => (d as HTMLElement).style.aspectRatio === '1 / 1',
    );
    expect(cell).toBeTruthy();
  });

  it('clicking a dot opens details, tap-away dismisses', () => {
    const { container } = render(<BookedCalendar appointments={[appt(0)]} />);
    const dot = container.querySelector('[data-testid^="appt-dot-"]') as HTMLElement;
    expect(dot).toBeTruthy();
    fireEvent.click(dot);
    expect(screen.getByTestId('appt-popover')).toBeInTheDocument();
    expect(screen.getByText('Mike R.')).toBeInTheDocument();
    expect(screen.getByText(/Driveway/)).toBeInTheDocument();
    expect(screen.getByText('$4,000')).toBeInTheDocument();
    // Tap-away: pointerdown outside the calendar clears the sticky popover
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('appt-popover')).not.toBeInTheDocument();
  });

  it('Escape closes a sticky popover', () => {
    const { container } = render(<BookedCalendar appointments={[appt(0)]} />);
    const dot = container.querySelector('[data-testid^="appt-dot-"]') as HTMLElement;
    fireEvent.click(dot);
    expect(screen.getByTestId('appt-popover')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('appt-popover')).not.toBeInTheDocument();
  });

  it('tapping the whole day cell toggles the first appointment popover (44px mobile target)', () => {
    render(<BookedCalendar appointments={[appt(0)]} />);
    const day = new Date().getDate();
    const cell = screen.getByTestId(`day-cell-${day}`);
    fireEvent.click(cell);
    expect(screen.getByTestId('appt-popover')).toBeInTheDocument();
    // Tapping the cell again dismisses it
    fireEvent.click(cell);
    expect(screen.queryByTestId('appt-popover')).not.toBeInTheDocument();
  });

  it('popover carries a column-aware alignment so edge columns never clip offscreen', () => {
    const { container } = render(<BookedCalendar appointments={[appt(0)]} />);
    const dot = container.querySelector('[data-testid^="appt-dot-"]') as HTMLElement;
    fireEvent.click(dot);
    const pop = screen.getByTestId('appt-popover');
    expect(['left', 'center', 'right']).toContain(pop.getAttribute('data-align'));
  });
});
