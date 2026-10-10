import { describe, expect, it } from 'vitest';
import { attributeBooking, CalcomOwnersConfigError, readCalcomOwners } from './attribution';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('readCalcomOwners', () => {
  it('is empty when unset', () => {
    const o = readCalcomOwners({});
    expect(o.byEvent.size + o.byOrganizer.size).toBe(0);
    expect(attributeBooking({ eventTypeId: 1 }, o)).toBeNull();
  });

  it('parses event and organizer matchers, normalizing case', () => {
    const o = readCalcomOwners({ CALCOM_BOOKING_OWNERS: ` ${A.toUpperCase()}=event:123 , ${A}=organizer:Ops@Client.Example,${B}=event:9` });
    expect(attributeBooking({ eventTypeId: 123 }, o)).toBe(A);
    expect(attributeBooking({ eventTypeId: '123' }, o)).toBe(A);
    expect(attributeBooking({ organizer: { email: 'ops@client.example' } }, o)).toBe(A);
    expect(attributeBooking({ eventTypeId: 9 }, o)).toBe(B);
    expect(attributeBooking({ eventTypeId: 5, organizer: { email: 'x@y.example' } }, o)).toBeNull();
    expect(attributeBooking(undefined, o)).toBeNull();
  });

  it('returns null when event and organizer disagree', () => {
    const o = readCalcomOwners({ CALCOM_BOOKING_OWNERS: `${A}=event:1,${B}=organizer:b@b.example` });
    expect(attributeBooking({ eventTypeId: 1, organizer: { email: 'b@b.example' } }, o)).toBeNull();
  });

  it.each([
    'no-equals',
    'not-a-uuid=event:1',
    `${A}=event:`,
    `${A}=event:abc`,
    `${A}=attendee:x@y.example`,
    `${A}=event:1,${B}=event:1`,
  ])('refuses %s', (value) => {
    expect(() => readCalcomOwners({ CALCOM_BOOKING_OWNERS: value })).toThrow(CalcomOwnersConfigError);
  });
});
