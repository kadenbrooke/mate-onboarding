import { describe, expect, it } from 'vitest';
import type { Lead } from '@/lib/metrics/leads';
import { filterOptedOutLeads, loadOptedOutPhones, normalizeJcConsentPhone, readLeadOptOutState } from './doNotContact';

const lead = (id: string, phone: string): Lead => ({
  id, name: id, city: null, service: null, phone, source: 'call', referrer_name: null,
  score: 90, status: 'open', quote_cents: null, contacted: true, after_hours: false,
  first_reply_seconds: null, created_at: '2026-10-09T12:00:00.000Z',
});

describe('J&C spoken opt-out phone contract', () => {
  it('mirrors the lane normalizer for valid US numbers', () => {
    expect(normalizeJcConsentPhone('(801) 555-0001')).toBe('+18015550001');
    expect(normalizeJcConsentPhone('+1 801 555 0001')).toBe('+18015550001');
  });

  it('rejects numbers the lane RPC will reject', () => {
    expect(normalizeJcConsentPhone('801-555-0001 ext 2')).toBeNull();
    expect(normalizeJcConsentPhone('1234567890')).toBeNull();
    expect(normalizeJcConsentPhone('')).toBeNull();
  });

  it.each([
    ['11 digits with a leading 1', '18015550001', '+18015550001'],
    ['11 digits without a leading 1', '28015550001', null],
    ['area code beginning with 0', '0555550001', null],
    ['area code beginning with 1', '1555550001', null],
    ['exchange beginning with 0', '8010550001', null],
    ['exchange beginning with 1', '8011550001', null],
    ['12 digits', '118015550001', null],
    ['angle bracket', '<8015550001>', null],
    ['uppercase X extension', '8015550001 X2', null],
  ])('matches the SQL normalizer for %s', (_case, raw, expected) => {
    expect(normalizeJcConsentPhone(raw)).toBe(expected);
  });

  it('filters only currently opted-out phones and admits a phone after its latch clears', () => {
    const optedOut = new Set(['+18015550001']);
    const rows = [lead('blocked', '(801) 555-0001'), lead('live', '+18015550002')];
    expect(filterOptedOutLeads(rows, optedOut).map(r => r.id)).toEqual(['live']);

    optedOut.delete('+18015550001');
    expect(filterOptedOutLeads(rows, optedOut).map(r => r.id)).toEqual(['blocked', 'live']);
  });

  it('reads the live latch in pages so a false START state brings the lead back', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ from_number: `+1801555${String(i).padStart(4, '0')}` }));
    rows[0] = { from_number: '+18015550001' };
    const rangeCalls: Array<[number, number]> = [];
    let cleared = false;
    const client = {
      from: () => ({
        select: (columns: string) => ({
          eq: (column: string, value: unknown) => ({
            range: async (from: number, to: number) => {
              expect(columns).toBe('from_number');
              expect(column).toBe('opted_out');
              expect(value).toBe(true);
              rangeCalls.push([from, to]);
              if (cleared) return { data: [], error: null };
              return { data: from === 0 ? rows : [{ from_number: '+18015550001' }], error: null };
            },
          }),
        }),
      }),
    };
    const first = await loadOptedOutPhones(client as never, '61400e73-0570-4167-88d9-d3a69650b15b', [lead('blocked', '+18015550001')]);
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999]]);
    expect(filterOptedOutLeads([lead('blocked', '+18015550001')], first.phones)).toHaveLength(0);

    cleared = true;
    const afterStartRead = await loadOptedOutPhones(client as never, '61400e73-0570-4167-88d9-d3a69650b15b', [lead('blocked', '+18015550001')]);
    expect(filterOptedOutLeads([lead('blocked', '+18015550001')], afterStartRead.phones)).toHaveLength(1);
  });

  it('hydrates a phone-call receipt on reload and identifies a STOP-only latch', async () => {
    let latch = true;
    const client = {
      from: (table: string) => table === 'jc_sms_conversations'
        ? { select: () => ({ eq: () => ({ range: async () => ({ data: latch ? [{ from_number: '+18015550001' }] : [], error: null }) }) }) }
        : { select: () => ({
            eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({
              data: { recorded_by: 'jeff@example.com', recorded_at: '2026-10-09T12:00:00.000Z', submitted_at: null }, error: null,
            }) }) }) }) }),
          }) },
    };
    const spoken = await readLeadOptOutState(client as never, '61400e73-0570-4167-88d9-d3a69650b15b', '+18015550001', { isPractice: false });
    expect(spoken).toMatchObject({ available: true, optedOut: true, source: 'phone_call', recordedBy: 'jeff@example.com' });

    latch = true;
    const stopClient = { ...client, from: (table: string) => table === 'jc_sms_conversations'
      ? { select: () => ({ eq: () => ({ range: async () => ({ data: [{ from_number: '+18015550001' }], error: null }) }) }) }
      : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) } };
    const stop = await readLeadOptOutState(stopClient as never, '61400e73-0570-4167-88d9-d3a69650b15b', '+18015550001', { isPractice: false });
    expect(stop).toMatchObject({ available: true, optedOut: true, source: 'text_stop', recordedBy: null });
  });
});
