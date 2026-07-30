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
