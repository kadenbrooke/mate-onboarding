// Which tenant a cal.com booking belongs to, from fields cal.com signs.
//
// The webhook payload carries no Mate session id, so a booking is attributed by
// its event type id or its organizer's email, both inside the HMAC-signed body
// (verifyCalcomSignature runs first, so neither can be forged by a caller).
//
// Config: CALCOM_BOOKING_OWNERS, comma-separated `<session uuid>=<matcher>`,
// where matcher is `event:<eventTypeId>` or `organizer:<email>`. A session may
// have several entries. Example (synthetic):
//   CALCOM_BOOKING_OWNERS=11111111-1111-4111-8111-111111111111=event:123,11111111-1111-4111-8111-111111111111=organizer:ops@client.example
//
// A malformed config throws CalcomOwnersConfigError: the caller must treat the
// booking as unattributable (hold it), never guess.

import { normalizeSessionId, type Env } from '@/lib/supabase/tenancy';

export type CalcomOwners = {
  byEvent: ReadonlyMap<string, string>;
  byOrganizer: ReadonlyMap<string, string>;
};

export class CalcomOwnersConfigError extends Error {
  constructor(message: string) {
    super(`CALCOM_BOOKING_OWNERS: ${message}`);
    this.name = 'CalcomOwnersConfigError';
  }
}

export function readCalcomOwners(env: Env = process.env): CalcomOwners {
  const byEvent = new Map<string, string>();
  const byOrganizer = new Map<string, string>();
  const raw = env.CALCOM_BOOKING_OWNERS?.trim() ?? '';
  for (const part of raw.split(',')) {
    if (part.trim() === '') continue;
    const eq = part.indexOf('=');
    if (eq < 0) throw new CalcomOwnersConfigError('entries look like <session uuid>=event:<id> or organizer:<email>');
    const session = normalizeSessionId(part.slice(0, eq));
    if (!session) throw new CalcomOwnersConfigError('entry has no valid session uuid');
    const matcher = part.slice(eq + 1).trim();
    const [kind, ...rest] = matcher.split(':');
    const value = rest.join(':').trim().toLowerCase();
    if (!value) throw new CalcomOwnersConfigError('matcher has no value');
    const target = kind === 'event' ? byEvent : kind === 'organizer' ? byOrganizer : null;
    if (!target) throw new CalcomOwnersConfigError(`unknown matcher "${kind}"`);
    if (kind === 'event' && !/^\d+$/.test(value)) throw new CalcomOwnersConfigError('event ids are numeric');
    const prior = target.get(value);
    if (prior && prior !== session) throw new CalcomOwnersConfigError('one matcher maps to two sessions');
    target.set(value, session);
  }
  return { byEvent, byOrganizer };
}

export type AttributablePayload = {
  eventTypeId?: number | string | null;
  organizer?: { email?: string | null } | null;
};

/**
 * The owning session, or null when nothing in the payload matches. When the
 * event type and organizer point at different sessions the booking is
 * ambiguous and also returns null (held, never guessed).
 */
export function attributeBooking(payload: AttributablePayload | undefined, owners: CalcomOwners): string | null {
  const p = payload ?? {};
  const event = p.eventTypeId === null || p.eventTypeId === undefined ? null : String(p.eventTypeId).trim();
  const organizer = p.organizer?.email?.trim().toLowerCase() || null;
  const byEvent = event ? owners.byEvent.get(event) ?? null : null;
  const byOrganizer = organizer ? owners.byOrganizer.get(organizer) ?? null : null;
  if (byEvent && byOrganizer && byEvent !== byOrganizer) return null;
  return byEvent ?? byOrganizer;
}
