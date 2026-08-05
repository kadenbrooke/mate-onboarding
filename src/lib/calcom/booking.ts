// Pure helpers for the cal.com BOOKING_CREATED webhook (cultivator-spec.md Piece 4).
// The J&C event type is "Free Estimate"; the FIRST booking is the quote/estimate
// appointment. A booking that lands while the row is already 'quoted_thinking'
// (Drip B, post-quote) is the SERVICE booking.

export type CalcomBookingPayload = {
  uid?: string;
  startTime?: string;
  endTime?: string;
  attendees?: Array<{ email?: string | null; name?: string | null; phoneNumber?: string | null }>;
  // cal.com booking-form answers; phone can live here under several keys.
  responses?: Record<string, { value?: unknown } | unknown>;
  userFieldsResponses?: Record<string, { value?: unknown } | unknown>;
  smsReminderNumber?: string | null;
};

export type CalcomWebhook = {
  triggerEvent?: string;
  payload?: CalcomBookingPayload;
};

function unwrap(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>).value;
    return typeof inner === 'string' ? inner : null;
  }
  return null;
}

/** Best-effort phone + email extraction from a cal.com booking payload. */
export function extractContact(payload: CalcomBookingPayload | undefined): { phone: string | null; email: string | null } {
  const p = payload ?? {};
  const a0 = p.attendees?.[0] ?? {};
  const responses = { ...(p.responses ?? {}), ...(p.userFieldsResponses ?? {}) } as Record<string, unknown>;

  const phoneCandidates = [
    a0.phoneNumber,
    p.smsReminderNumber,
    unwrap(responses.phone),
    unwrap(responses.attendeePhoneNumber),
    unwrap(responses.phoneNumber),
    unwrap(responses.location), // cal.com "attendeeInPerson"/phone location sometimes carries the number
  ];
  const phone = phoneCandidates.map(normalizePhone).find((v): v is string => !!v) ?? null;

  const email = (a0.email && a0.email.trim().toLowerCase()) || unwrap(responses.email)?.trim().toLowerCase() || null;
  return { phone, email };
}

/**
 * Normalize to an E.164 string. Rules:
 * - already-`+`  : kept (formatting stripped).
 * - bare US 10-digit (e.g. 8015551234) : prepend country code -> `+1XXXXXXXXXX`.
 * - 11-digit leading `1` (e.g. 18015551234) : `+1XXXXXXXXXX`.
 * - other no-`+` lengths : prepend a bare `+` (best-effort international).
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (cleaned.startsWith('+')) return cleaned;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Build the jc_sms_conversations patch for a BOOKING_CREATED event, given the
 * row's CURRENT status. Booking always exits any active drip.
 */
export function buildBookingPatch(
  currentStatus: string | null | undefined,
  payload: CalcomBookingPayload,
  now: Date,
): Record<string, unknown> {
  const uid = payload.uid ?? null;
  const endAt = payload.endTime ?? null;
  const base: Record<string, unknown> = {
    calcom_booking_uid: uid,
    campaign: 'none',
    next_drip_due_at: null,
  };
  if (currentStatus === 'quoted_thinking') {
    // Drip B was running -> this is the service booking.
    return { ...base, status: 'service_booked', service_booked_at: now.toISOString() };
  }
  // First booking -> the quote/estimate appointment.
  return {
    ...base,
    status: 'quote_booked',
    quote_booked_at: now.toISOString(),
    quote_appt_end_at: endAt,
  };
}
