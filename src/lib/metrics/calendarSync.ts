// src/lib/metrics/calendarSync.ts
//
// Google Calendar -> client_appointments mapping. Pure by design (no network,
// no Supabase) so it unit-tests without a socket, matching the ads.ts /
// adsFetch.ts split. The network half lives in calendarFetch.ts and the
// orchestration in calendarSyncRun.ts.
//
// The Calendar zone (BookedCalendar) renders client_appointments rows. Before
// this, nothing populated that table for a real client -- only the seeded demo
// session had rows. A connected client's `primary` calendar is now the source.
//
// Two rules shape everything below:
//   1. NEVER INVENT DATA. A calendar event carries a title, maybe a guest, and
//      maybe a description. It does not carry a price. price_cents stays null
//      unless a single unambiguous dollar amount is written in the text.
//   2. CANCELLED IS REMOVED, NOT SHOWN. Google returns cancelled instances of
//      recurring events in a singleEvents listing; those must never render as
//      a booked job, so they come back as ids to delete rather than rows.

/** `start` / `end` on a Google Calendar event. Timed events carry `dateTime`
 *  (RFC3339 with offset); all-day events carry `date` (YYYY-MM-DD). */
export type GoogleCalendarEventDate = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export type GoogleCalendarAttendee = {
  email?: string;
  displayName?: string;
  /** True on the attendee row representing the calendar owner. */
  self?: boolean;
  /** Rooms/equipment, not people. */
  resource?: boolean;
  organizer?: boolean;
};

/** The slice of a Google Calendar event resource we consume. */
export type GoogleCalendarEvent = {
  id?: string;
  /** 'confirmed' | 'tentative' | 'cancelled' */
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarEventDate;
  end?: GoogleCalendarEventDate;
  attendees?: GoogleCalendarAttendee[];
  organizer?: { email?: string; self?: boolean };
};

/** Row shape written to `client_appointments` (one row per calendar event). */
export type AppointmentRow = {
  session_id: string;
  google_event_id: string;
  customer_name: string | null;
  service: string | null;
  price_cents: number | null;
  starts_at: string; // ISO 8601, UTC
};

export type MappedEvents = {
  /** Live events, ready to upsert. Deduped on google_event_id. */
  rows: AppointmentRow[];
  /** Ids of events Google reported as cancelled; delete these, do not render. */
  cancelledIds: string[];
};

/** How far back and forward we pull, in days. Back far enough that the current
 *  month always renders complete; forward far enough to cover a booked-out
 *  season without pulling a client's whole calendar history. */
const WINDOW_DAYS_BACK = 30;
const WINDOW_DAYS_FORWARD = 90;

const DAY_MS = 86_400_000;

/** The pull window, as the RFC3339 bounds the Calendar API expects. */
export function syncWindow(now: Date = new Date()): { timeMin: string; timeMax: string } {
  return {
    timeMin: new Date(now.getTime() - WINDOW_DAYS_BACK * DAY_MS).toISOString(),
    timeMax: new Date(now.getTime() + WINDOW_DAYS_FORWARD * DAY_MS).toISOString(),
  };
}

/**
 * A single unambiguous dollar amount written in the event text, in whole cents.
 *
 * Deliberately conservative. Two DIFFERENT amounts in one event ("$300 deposit,
 * $1,200 balance") is ambiguous, so it yields null rather than a guess -- a
 * wrong number on the client's revenue tile is worse than a blank one. Repeats
 * of the SAME amount are not ambiguous and resolve normally.
 */
export function parsePriceCents(...texts: (string | null | undefined)[]): number | null {
  const money = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  const found = new Set<number>();

  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(money)) {
      const dollars = Number(m[1].replace(/,/g, ''));
      if (!Number.isFinite(dollars)) continue;
      // '.5' means 50 cents, '.50' means 50 cents; pad a single digit.
      const cents = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
      found.add(dollars * 100 + cents);
    }
  }

  if (found.size !== 1) return null;
  return [...found][0];
}

/** "mike.reynolds@gmail.com" -> "Mike Reynolds". A display of the address we
 *  already have, not an invention. Falls back to the raw address. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(' ') : email;
}

/** The first real guest on the event: not the calendar owner, not a room. */
export function guestName(event: GoogleCalendarEvent): string | null {
  const organizerEmail = event.organizer?.email?.toLowerCase() ?? null;
  for (const a of event.attendees ?? []) {
    if (a.self || a.resource || a.organizer) continue;
    if (organizerEmail && a.email?.toLowerCase() === organizerEmail) continue;
    const display = (a.displayName ?? '').trim();
    if (display) return display;
    const email = (a.email ?? '').trim();
    if (email) return nameFromEmail(email);
  }
  return null;
}

/**
 * Event start as a UTC ISO string, or null when the event has no usable start.
 *
 * All-day events carry only a date, and the month grid buckets by the LOCAL
 * day. Anchoring an all-day event at midnight UTC would land it on the previous
 * day for every US timezone, so it is anchored at 12:00 UTC -- the same
 * calendar day everywhere from UTC-11 to UTC+11.
 */
export function startsAtIso(start: GoogleCalendarEventDate | undefined): string | null {
  if (start?.dateTime) {
    const d = new Date(start.dateTime);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (start?.date && /^\d{4}-\d{2}-\d{2}$/.test(start.date)) {
    return `${start.date}T12:00:00.000Z`;
  }
  return null;
}

/**
 * Map a page of Calendar events onto appointment rows for ONE session.
 *
 * Naming rules, stated once because they are a judgment call:
 *  - With a guest on the event, the guest IS the customer and the title is the
 *    service. That is the shape a booking tool (cal.com, Google's own booking
 *    pages) writes.
 *  - Without a guest, the title is free text a human typed ("Driveway sealcoat
 *    - Mike R.") and there is no reliable way to know which half is the person.
 *    So the whole title becomes customer_name and service stays null. Showing
 *    the client exactly what they typed beats guessing wrong.
 */
export function mapEventsToRows(
  events: GoogleCalendarEvent[],
  sessionId: string,
): MappedEvents {
  const cancelledIds: string[] = [];
  // Keyed so a repeated id inside one payload collapses to one row: an upsert
  // carrying the same conflict key twice fails ("cannot affect row a second
  // time"), which would drop the whole batch.
  const byId = new Map<string, AppointmentRow>();

  for (const event of events) {
    const id = (event.id ?? '').trim();
    if (!id) continue; // no stable key -> nothing to upsert idempotently

    if (event.status === 'cancelled') {
      cancelledIds.push(id);
      byId.delete(id);
      continue;
    }

    const startsAt = startsAtIso(event.start);
    if (!startsAt) continue; // malformed event; skip rather than write a bad date

    const summary = (event.summary ?? '').trim();
    const guest = guestName(event);

    byId.set(id, {
      session_id: sessionId,
      google_event_id: id,
      customer_name: guest ?? (summary || null),
      service: guest ? summary || null : null,
      price_cents: parsePriceCents(summary, event.description),
      starts_at: startsAt,
    });
  }

  return {
    rows: [...byId.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    cancelledIds,
  };
}
