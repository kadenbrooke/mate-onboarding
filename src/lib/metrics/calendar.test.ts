// src/lib/metrics/calendar.test.ts
import { describe, it, expect } from 'vitest';
import { monthGrid, type Appointment } from './calendar';

const appt = (day: number): Appointment => ({
  id: Math.random().toString(), customer_name: 'A', service: 'Driveway',
  price_cents: 100000, starts_at: new Date(2026, 6, day, 17).toISOString(),
});

describe('monthGrid', () => {
  it('builds a grid for the month with appointments on their days and $ total', () => {
    const grid = monthGrid([appt(3), appt(3), appt(20)], new Date(2026, 6, 15));
    expect(grid.weeks.length).toBeGreaterThanOrEqual(4);
    const day3 = grid.weeks.flat().find(c => c && c.day === 3);
    expect(day3?.appointments).toHaveLength(2);
    expect(grid.totalCount).toBe(3);
    expect(grid.totalCents).toBe(300000);
    expect(grid.monthLabel).toMatch(/JULY 2026/i);
  });

  it('excludes appointments outside the month from totals', () => {
    const outside = { ...appt(1), starts_at: new Date(2026, 7, 1).toISOString() };
    const grid = monthGrid([outside], new Date(2026, 6, 15));
    expect(grid.totalCount).toBe(0);
  });
});
