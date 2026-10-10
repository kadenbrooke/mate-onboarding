import { describe, expect, it, vi } from 'vitest';
import type { Lead } from '@/lib/metrics/leads';
import { filterOptedOutLeads, loadOptedOutPhones, normalizeJcConsentPhone } from './doNotContact';

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

  it('filters only currently opted-out phones and admits a phone after its latch clears', () => {
    const optedOut = new Set(['+18015550001']);
    const rows = [lead('blocked', '(801) 555-0001'), lead('live', '+18015550002')];
    expect(filterOptedOutLeads(rows, optedOut).map(r => r.id)).toEqual(['live']);

    optedOut.delete('+18015550001');
    expect(filterOptedOutLeads(rows, optedOut).map(r => r.id)).toEqual(['blocked', 'live']);
  });

  it('reads the live latch so a false START state brings the lead back', async () => {
    const result = vi.fn();
    const queryArgs: Array<[string, string[]]> = [];
    const client = {
      from: () => ({
        select: () => ({ in: (column: string, phones: string[]) => { queryArgs.push([column, phones]); return result(); } }),
      }),
    };
    result.mockResolvedValue({ data: [{ from_number: '+18015550001', opted_out: true }], error: null });
    const first = await loadOptedOutPhones(client as never, '61400e73-0570-4167-88d9-d3a69650b15b', [lead('blocked', '+18015550001')]);
    expect(queryArgs[0]).toEqual(['from_number', ['+18015550001']]);
    expect(filterOptedOutLeads([lead('blocked', '+18015550001')], first.phones)).toHaveLength(0);

    result.mockResolvedValue({ data: [{ from_number: '+18015550001', opted_out: false }], error: null });
    const afterStart = await loadOptedOutPhones(client as never, '61400e73-0570-4167-88d9-d3a69650b15b', [lead('blocked', '+18015550001')]);
    expect(filterOptedOutLeads([lead('blocked', '+18015550001')], afterStart.phones)).toHaveLength(1);
  });
});
