import { describe, it, expect } from 'vitest';
import {
  mapEventsToRows,
  parsePriceCents,
  startsAtIso,
  guestName,
  syncWindow,
  type GoogleCalendarEvent,
} from './calendarSync';

const SESSION = '61400e73-0570-4167-88d9-d3a69650b15b';

// Shaped after a real Google Calendar v3 list response (singleEvents=true,
// orderBy=startTime), trimmed to the fields the mapper consumes.
const EVENTS: GoogleCalendarEvent[] = [
  {
    // Booking-tool shape: guest on the event, service in the title.
    id: 'evt_booked_1',
    status: 'confirmed',
    summary: 'Driveway sealcoat',
    description: 'Quoted $1,840.00 - two-car driveway',
    start: { dateTime: '2026-08-14T17:00:00-06:00', timeZone: 'America/Denver' },
    end: { dateTime: '2026-08-14T19:00:00-06:00' },
    organizer: { email: 'jeff@jcasphalt.com', self: true },
    attendees: [
      { email: 'jeff@jcasphalt.com', self: true, organizer: true },
      { email: 'mike.reynolds@gmail.com' },
    ],
  },
  {
    // Hand-typed shape: no guest, free-text title.
    id: 'evt_typed_2',
    status: 'confirmed',
    summary: 'Crack fill - Karen B.',
    start: { dateTime: '2026-08-16T15:30:00Z' },
  },
  {
    // All-day event.
    id: 'evt_allday_3',
    status: 'confirmed',
    summary: 'Parking lot striping',
    start: { date: '2026-08-20' },
    attendees: [{ displayName: 'Todd R.', email: 'todd@example.com' }],
  },
  {
    // Cancelled instance of a recurring series.
    id: 'evt_booked_1_20260821T170000Z',
    status: 'cancelled',
    start: { dateTime: '2026-08-21T17:00:00-06:00' },
  },
];

describe('syncWindow', () => {
  it('spans 30 days back to 90 days forward as RFC3339 bounds', () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const { timeMin, timeMax } = syncWindow(now);
    expect(timeMin).toBe('2026-07-13T00:00:00.000Z');
    expect(timeMax).toBe('2026-11-10T00:00:00.000Z');
  });
});

describe('startsAtIso', () => {
  it('normalizes an offset dateTime to UTC', () => {
    expect(startsAtIso({ dateTime: '2026-08-14T17:00:00-06:00' })).toBe('2026-08-14T23:00:00.000Z');
  });

  it('anchors an all-day event at noon UTC so it lands on the right local day', () => {
    // Midnight UTC would render as the 19th in any US timezone.
    expect(startsAtIso({ date: '2026-08-20' })).toBe('2026-08-20T12:00:00.000Z');
  });

  it('returns null for a missing or malformed start', () => {
    expect(startsAtIso(undefined)).toBeNull();
    expect(startsAtIso({})).toBeNull();
    expect(startsAtIso({ date: 'not-a-date' })).toBeNull();
    expect(startsAtIso({ dateTime: 'garbage' })).toBeNull();
  });
});

describe('guestName', () => {
  it('skips the calendar owner and returns the real guest', () => {
    expect(guestName(EVENTS[0])).toBe('Mike Reynolds');
  });

  it('prefers displayName over the email', () => {
    expect(guestName(EVENTS[2])).toBe('Todd R.');
  });

  it('returns null when there are no attendees, or only rooms', () => {
    expect(guestName(EVENTS[1])).toBeNull();
    expect(guestName({ attendees: [{ email: 'room-a@resource.calendar.google.com', resource: true }] })).toBeNull();
  });
});

describe('parsePriceCents', () => {
  it('parses a single dollar amount with separators and cents', () => {
    expect(parsePriceCents('Quoted $1,840.00')).toBe(184000);
    expect(parsePriceCents('$300')).toBe(30000);
    expect(parsePriceCents('$45.5 rush fee')).toBe(4550);
  });

  it('reads across summary and description', () => {
    expect(parsePriceCents('Sealcoat', 'total $980')).toBe(98000);
  });

  it('invents nothing when there is no amount', () => {
    expect(parsePriceCents('Driveway sealcoat', 'two-car driveway')).toBeNull();
    expect(parsePriceCents(undefined, null)).toBeNull();
  });

  it('refuses to guess between two different amounts', () => {
    expect(parsePriceCents('$300 deposit, $1,200 balance')).toBeNull();
  });

  it('tolerates the same amount repeated', () => {
    expect(parsePriceCents('$300 due', 'confirmed $300')).toBe(30000);
  });
});

describe('mapEventsToRows', () => {
  it('maps a booking-tool event: guest is the customer, title is the service', () => {
    const { rows } = mapEventsToRows(EVENTS, SESSION);
    expect(rows.find((r) => r.google_event_id === 'evt_booked_1')).toEqual({
      session_id: SESSION,
      google_event_id: 'evt_booked_1',
      customer_name: 'Mike Reynolds',
      service: 'Driveway sealcoat',
      price_cents: 184000,
      starts_at: '2026-08-14T23:00:00.000Z',
    });
  });

  it('keeps a hand-typed title whole rather than guessing which half is the name', () => {
    const { rows } = mapEventsToRows(EVENTS, SESSION);
    const row = rows.find((r) => r.google_event_id === 'evt_typed_2');
    expect(row).toMatchObject({ customer_name: 'Crack fill - Karen B.', service: null, price_cents: null });
  });

  it('removes cancelled events instead of showing them', () => {
    const { rows, cancelledIds } = mapEventsToRows(EVENTS, SESSION);
    expect(rows.map((r) => r.google_event_id)).not.toContain('evt_booked_1_20260821T170000Z');
    expect(cancelledIds).toEqual(['evt_booked_1_20260821T170000Z']);
  });

  it('drops a row that was later cancelled in the same payload', () => {
    const { rows, cancelledIds } = mapEventsToRows(
      [
        { id: 'evt_x', status: 'confirmed', summary: 'Sealcoat', start: { dateTime: '2026-08-14T17:00:00Z' } },
        { id: 'evt_x', status: 'cancelled', start: { dateTime: '2026-08-14T17:00:00Z' } },
      ],
      SESSION,
    );
    expect(rows).toEqual([]);
    expect(cancelledIds).toEqual(['evt_x']);
  });

  it('stamps every row with the given session id and nothing else', () => {
    const { rows } = mapEventsToRows(EVENTS, SESSION);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.session_id === SESSION)).toBe(true);
  });

  it('dedupes a repeated event id so the upsert cannot hit the same key twice', () => {
    const { rows } = mapEventsToRows(
      [
        { id: 'dupe', status: 'confirmed', summary: 'First', start: { dateTime: '2026-08-14T17:00:00Z' } },
        { id: 'dupe', status: 'confirmed', summary: 'Second', start: { dateTime: '2026-08-15T17:00:00Z' } },
      ],
      SESSION,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_name).toBe('Second'); // last write wins
  });

  it('skips events with no id or no usable start', () => {
    const { rows } = mapEventsToRows(
      [
        { status: 'confirmed', summary: 'No id', start: { dateTime: '2026-08-14T17:00:00Z' } },
        { id: 'no_start', status: 'confirmed', summary: 'No start' },
      ],
      SESSION,
    );
    expect(rows).toEqual([]);
  });

  it('returns rows ordered by start time', () => {
    const { rows } = mapEventsToRows(EVENTS, SESSION);
    const starts = rows.map((r) => r.starts_at);
    expect([...starts].sort()).toEqual(starts);
  });
});
