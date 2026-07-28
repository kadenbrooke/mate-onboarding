// src/lib/metrics/calendar.ts
export type Appointment = {
  id: string; customer_name: string | null; service: string | null;
  price_cents: number | null; starts_at: string;
};
export type DayCell = { day: number; isToday: boolean; appointments: Appointment[] };

export function monthGrid(appointments: Appointment[], now = new Date()) {
  const year = now.getFullYear(), month = now.getMonth();
  const inMonth = appointments.filter(a => {
    const d = new Date(a.starts_at);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const byDay = new Map<number, Appointment[]>();
  for (const a of inMonth) {
    const day = new Date(a.starts_at).getDate();
    const arr = byDay.get(day);
    if (arr) arr.push(a); else byDay.set(day, [a]);
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Mon = 0
  const cells: (DayCell | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, isToday: day === now.getDate(), appointments: byDay.get(day) ?? [] });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (DayCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  return {
    weeks, monthLabel,
    totalCount: inMonth.length,
    totalCents: inMonth.reduce((a, x) => a + (x.price_cents ?? 0), 0),
  };
}
