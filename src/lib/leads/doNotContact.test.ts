import { describe, expect, it } from 'vitest';
import type { Lead } from '@/lib/metrics/leads';
import { filterOptedOutLeads, isOptedOut, loadOptedOutPhones, normalizeJcConsentPhone, readLeadOptOutState } from './doNotContact';

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
    const orderCalls: Array<[string, { ascending: boolean }]> = [];
    let cleared = false;
    const client = {
      from: () => ({
        select: (columns: string) => ({
          eq: (column: string, value: unknown) => ({
            order: (orderColumn: string, options: { ascending: boolean }) => ({
              range: async (from: number, to: number) => {
              expect(columns).toBe('from_number');
              expect(column).toBe('opted_out');
              expect(value).toBe(true);
              orderCalls.push([orderColumn, options]);
              rangeCalls.push([from, to]);
              if (cleared) return { data: [], error: null };
              return { data: from === 0 ? rows : [{ from_number: '+18015550001' }], error: null };
              },
            }),
          }),
        }),
      }),
    };
    const first = await loadOptedOutPhones(client as never, '61400e73-0570-4167-88d9-d3a69650b15b', [lead('blocked', '+18015550001')]);
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999]]);
    expect(orderCalls[0]).toEqual(['from_number', { ascending: true }]);
    expect(filterOptedOutLeads([lead('blocked', '+18015550001')], first.phones)).toHaveLength(0);

    cleared = true;
    const afterStartRead = await loadOptedOutPhones(client as never, '61400e73-0570-4167-88d9-d3a69650b15b', [lead('blocked', '+18015550001')]);
    expect(filterOptedOutLeads([lead('blocked', '+18015550001')], afterStartRead.phones)).toHaveLength(1);
  });

  it('fails closed when the shared scan reaches its page ceiling', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              range: async () => ({
                data: Array.from({ length: 1000 }, (_, i) => ({ from_number: `+1801555${String(i).padStart(4, '0')}` })),
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    const result = await loadOptedOutPhones(client as never, '61400e73-0570-4167-88d9-d3a69650b15b', [lead('blocked', '+18015550001')]);
    expect(result).toEqual({ available: false, phones: new Set() });
  });

  it('hydrates a phone-call receipt on reload and identifies a STOP-only latch', async () => {
    let latch = true;
    const client = {
      from: (table: string) => table === 'jc_sms_conversations'
        ? { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: latch ? [{ from_number: '+18015550001' }] : [], error: null }) }) }) }) }
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
      ? { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [{ from_number: '+18015550001' }], error: null }) }) }) }) }
      : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) } };
    const stop = await readLeadOptOutState(stopClient as never, '61400e73-0570-4167-88d9-d3a69650b15b', '+18015550001', { isPractice: false });
    expect(stop).toMatchObject({ available: true, optedOut: true, source: 'text_stop', recordedBy: null });

    const receiptErrorClient = { ...client, from: (table: string) => table === 'jc_sms_conversations'
      ? { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [{ from_number: '+18015550001' }], error: null }) }) }) }) }
      : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'receipt unavailable' } }) }) }) }) }) }) } };
    const unknown = await readLeadOptOutState(receiptErrorClient as never, '61400e73-0570-4167-88d9-d3a69650b15b', '+18015550001', { isPractice: false });
    expect(unknown).toMatchObject({ available: true, optedOut: true, source: 'unknown', recordedBy: null, recordedAt: null });
  });

  it('loads every practice fake marker with one paged query and reuses it for both leads', async () => {
    const rows = [
      { id: 'a', body: '[Practice fake] Do not contact phone=+18015550001 phone=+18015550003 recorded_by=aranza@example.com', created_at: '2026-10-09T10:00:00.000Z' },
      ...Array.from({ length: 999 }, (_, i) => ({ id: `filler-${i}`, body: 'ordinary call note', created_at: '2026-10-09T10:01:00.000Z' })),
      { id: 'b', body: '[Practice fake] Do not contact phone=+18015550002 recorded_by=jeff@example.com', created_at: '2026-10-09T11:00:00.000Z' },
    ];
    const ranges: Array<[number, number]> = [];
    let order: [string, { ascending: boolean }] | null = null;
    const client = {
      from: (table: string) => table === 'onboarding_sessions'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_practice: true }, error: null }) }) }) }
        : { select: () => ({
            eq: () => query,
          }) },
    };
    const query = {
      eq: () => query,
      like: () => query,
      order: (column: string, options: { ascending: boolean }) => ({
        range: async (from: number, to: number) => {
          order = [column, options];
          ranges.push([from, to]);
          return { data: from === 0 ? rows.slice(0, 1000) : rows.slice(1000), error: null };
        },
      }),
    };
    const result = await loadOptedOutPhones(client as never, 'practice', [lead('a', '+18015550001'), lead('b', '+18015550002'), lead('c', '+18015550003')]);
    expect(result.available).toBe(true);
    expect([...result.phones]).toEqual(['+18015550001', '+18015550002', '+18015550003']);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(order).toEqual(['id', { ascending: true }]);

    const state = await readLeadOptOutState(client as never, 'practice', '+18015550002', { isPractice: true });
    expect(state).toMatchObject({ optedOut: true, source: 'practice', recordedBy: 'jeff@example.com' });
  });

  it('fails closed for an invalid J&C phone instead of allowing a send', async () => {
    expect(await isOptedOut({} as never, '61400e73-0570-4167-88d9-d3a69650b15b', '8010550001', { isPractice: false })).toBe(true);
    expect(await readLeadOptOutState({} as never, '61400e73-0570-4167-88d9-d3a69650b15b', '8010550001', { isPractice: false })).toMatchObject({
      available: false, optedOut: true, unavailableReason: 'invalid_phone',
    });
  });

  it('does not apply the J&C invalid-phone guard to practice or other tenants', async () => {
    expect(await isOptedOut({} as never, 'practice', '8010550001', { isPractice: true })).toBe(false);
    expect(await isOptedOut({} as never, 'non-jc-tenant', '8010550001', { isPractice: false })).toBe(false);
  });
});
