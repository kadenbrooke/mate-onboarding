// Quiet-hours guard for AGENT-initiated sends only (nurture cron, agent auto-sends).
// Human sends (dashboard, relay, post-call actions) never call this.
export type QuietHours = {
  tz: string;            // IANA zone, e.g. "America/Denver"
  start: string;         // "HH:MM" local
  end: string;           // "HH:MM" local
  skip_days: number[];   // JS getDay(): 0=Sunday
};

/** Local wall-clock parts for `at` in the given IANA zone. */
function localParts(tz: string, at: Date): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map(p => [p.type, p.value]));
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parts.hour === '24' ? 0 : Number(parts.hour); // Intl can emit "24" at midnight
  return { day: dayMap[parts.weekday], minutes: hour * 60 + Number(parts.minute) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** True when an agent-initiated send is allowed right now under `qh`. Null = always allowed. */
export function isWithinSendWindow(qh: QuietHours | null, now: Date = new Date()): boolean {
  if (!qh) return true;
  const { day, minutes } = localParts(qh.tz, now);
  if (qh.skip_days?.includes(day)) return false;
  return minutes >= toMinutes(qh.start) && minutes < toMinutes(qh.end);
}

/** The default outreach window: 08:00 to 20:00 America/Denver, Sunday blocked.
 *  Matches the gate the Cultivator drip and manager escalations already use. */
export const DEFAULT_OUTREACH_HOURS: QuietHours = {
  tz: 'America/Denver',
  start: '08:00',
  end: '20:00',
  skip_days: [0],
};

/** Full local wall-clock parts for `at` in `tz`, plus the zone offset at that instant. */
function zoneParts(tz: string, at: Date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map(x => [x.type, x.value]));
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    hour, Number(p.minute), Number(p.second),
  );
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour, minute: Number(p.minute),
    // How far the zone's wall clock runs ahead of UTC at this instant.
    offsetMs: asIfUtc - at.getTime(),
  };
}

/** The instant at which `tz` reads the given wall-clock time.
 *
 *  Two passes, because the offset depends on the answer: the first pass uses
 *  the offset at the guessed instant, the second corrects it if that guess
 *  landed on the other side of a DST boundary. */
function fromZonedWallClock(
  tz: string, year: number, month: number, day: number, hour: number, minute: number,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(wall);
  for (let i = 0; i < 2; i += 1) {
    guess = new Date(wall - zoneParts(tz, guess).offsetMs);
  }
  return guess;
}

/**
 * The earliest instant at or after `at` that falls inside `qh`'s send window.
 *
 * This is the Lead Snapshot release condition. A snapshot lead is outreach WE
 * initiate (a number read off a photographed note never contacted us), so it
 * queues rather than texting a stranger overnight. The confirm path stamps the
 * result of this onto jc_sms_conversations.send_after and the Intro Pending
 * drain releases the row once that time passes.
 *
 * Why a stored timestamp and not a window check in the drain: the drain is
 * shared with Meta form leads, whose intro is deliberately hour-blind since
 * 2026-08-25. Re-gating there would undo that. See migration 0017 section 3.
 *
 * Returns `at` unchanged when it is already inside the window, so a lead
 * confirmed at 2pm on a Tuesday goes out immediately. Null `qh` means no hold.
 */
export function nextSendWindowStart(qh: QuietHours | null, at: Date = new Date()): Date {
  if (!qh) return at;
  if (isWithinSendWindow(qh, at)) return at;

  const startMinutes = toMinutes(qh.start);
  const startHour = Math.floor(startMinutes / 60);
  const startMinute = startMinutes % 60;
  const skip = new Set(qh.skip_days ?? []);

  let cursor = at;
  // Bounded at 8 hops. Each hop advances at least to the next day's opening,
  // so even a Saturday-night start with Sunday skipped settles on the second.
  // The bound exists so a pathological config (every day skipped) cannot spin.
  for (let i = 0; i < 8; i += 1) {
    const p = zoneParts(qh.tz, cursor);
    const local = localParts(qh.tz, cursor);
    const beforeOpen = local.minutes < startMinutes;

    // Today still works only if the day is allowed and we have not passed
    // closing. Otherwise roll to the next day's opening bell.
    const sameDay = !skip.has(local.day) && beforeOpen;
    const target = fromZonedWallClock(
      qh.tz, p.year, p.month, sameDay ? p.day : p.day + 1, startHour, startMinute,
    );

    if (isWithinSendWindow(qh, target)) return target;
    cursor = target;
  }
  return cursor;
}
