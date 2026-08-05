import { describe, it, expect } from 'vitest';
import { extractContact, normalizePhone, buildBookingPatch } from './booking';

describe('normalizePhone', () => {
  it('keeps a leading + and strips formatting', () => {
    expect(normalizePhone('+1 (801) 555-1234')).toBe('+18015551234');
  });
  it('prepends +1 for a bare US 10-digit number', () => {
    expect(normalizePhone('8015551234')).toBe('+18015551234');
    expect(normalizePhone('(801) 555-1234')).toBe('+18015551234');
  });
  it('prepends + for an 11-digit number with a leading 1', () => {
    expect(normalizePhone('18015551234')).toBe('+18015551234');
    expect(normalizePhone('1 801-555-1234')).toBe('+18015551234');
  });
  it('rejects short/garbage', () => {
    expect(normalizePhone('n/a')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe('extractContact', () => {
  it('reads phone + email from the first attendee', () => {
    const { phone, email } = extractContact({
      attendees: [{ email: 'Lead@Example.com', phoneNumber: '+18015551234' }],
    });
    expect(phone).toBe('+18015551234');
    expect(email).toBe('lead@example.com');
  });
  it('falls back to responses for the phone', () => {
    const { phone } = extractContact({
      attendees: [{ email: 'x@y.com' }],
      responses: { phone: { value: '801-555-9999' } },
    });
    expect(phone).toBe('+18015559999');
  });
  it('returns nulls when nothing is present', () => {
    expect(extractContact({})).toEqual({ phone: null, email: null });
    expect(extractContact(undefined)).toEqual({ phone: null, email: null });
  });
});

describe('buildBookingPatch', () => {
  const now = new Date('2026-08-04T20:00:00.000Z');
  const payload = { uid: 'bk_1', endTime: '2026-08-06T17:30:00.000Z' };

  it('treats a first booking as the quote appointment and exits any drip', () => {
    const patch = buildBookingPatch('engaged', payload, now);
    expect(patch).toMatchObject({
      status: 'quote_booked',
      quote_booked_at: now.toISOString(),
      quote_appt_end_at: '2026-08-06T17:30:00.000Z',
      calcom_booking_uid: 'bk_1',
      campaign: 'none',
      next_drip_due_at: null,
    });
  });

  it('treats a booking during Drip B (quoted_thinking) as the service booking', () => {
    const patch = buildBookingPatch('quoted_thinking', payload, now);
    expect(patch).toMatchObject({
      status: 'service_booked',
      service_booked_at: now.toISOString(),
      campaign: 'none',
      next_drip_due_at: null,
    });
    expect(patch.quote_booked_at).toBeUndefined();
  });
});
