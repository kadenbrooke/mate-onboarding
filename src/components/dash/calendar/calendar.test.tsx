import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
