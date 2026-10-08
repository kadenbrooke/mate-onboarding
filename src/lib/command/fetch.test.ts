import { describe, it, expect, vi } from 'vitest';
import {
  fetchLeadSignals, fetchLastOutbound, fetchPaidByLead, toLiveScores, CHUNK,
  type SignalQuery, type OutboundQuery, type PaymentQuery,
} from './fetch';

type Err = { message: string; code?: string } | null;
const ids = (k: number) => Array.from({ length: k }, (_, i) => `lead-${i}`);

function signalStub(respond: (ids: string[]) => { data: unknown[] | null; error: Err }) {
  const calls: { session: string; ids: string[] }[] = [];
  const q = {
    from: () => ({
      select: () => ({
        eq: (_c: string, session: string) => ({
          in: (_c2: string, chunk: string[]) => { calls.push({ session, ids: chunk }); return Promise.resolve(respond(chunk)); },
        }),
      }),
    }),
  } as unknown as SignalQuery & PaymentQuery;
  return { q, calls };
}

describe('fetchLeadSignals', () => {
  it('reads exactly the given ids in tenant-scoped chunks', async () => {
    const all = ids(CHUNK + 20);
    const { q, calls } = signalStub(chunk => ({
      data: chunk.map(id => ({ lead_id: id, score: 70, tier: '1', timeframe: null, last_lead_reply_at: null })), error: null,
    }));
    const r = await fetchLeadSignals(q, 's-1', all);
    expect(calls).toHaveLength(2);
    expect(calls.every(c => c.session === 's-1')).toBe(true);
    expect(calls.flatMap(c => c.ids)).toEqual(all);
    expect(r.status).toBe('live');
    const live = toLiveScores(r);
    expect(live.status === 'live' && live.scores.get('lead-0')).toBe(70);
  });
  it('reports a missing view and an error distinctly', async () => {
    const missing = signalStub(() => ({ data: null, error: { message: 'nope', code: '42P01' } }));
    expect((await fetchLeadSignals(missing.q, 's', ['a'])).status).toBe('missing');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = signalStub(() => ({ data: null, error: { message: 'boom' } }));
    expect(toLiveScores(await fetchLeadSignals(broken.q, 's', ['a'])).status).toBe('error');
    spy.mockRestore();
  });
  it('makes no request for no ids', async () => {
    const { q, calls } = signalStub(() => ({ data: [], error: null }));
    expect((await fetchLeadSignals(q, 's', [])).status).toBe('live');
    expect(calls).toHaveLength(0);
  });
});

describe('fetchLastOutbound', () => {
  function outboundStub(rows: { lead_id: string; created_at: string }[] | null, error: Err = null) {
    const filters: unknown[][] = [];
    const q = {
      from: () => ({
        select: () => ({
          eq: (c1: string, v1: string) => ({
            eq: (c2: string, v2: string) => ({
              in: (_c: string, chunk: string[]) => ({
                order: () => ({
                  limit: () => { filters.push([c1, v1, c2, v2, chunk]); return Promise.resolve({ data: rows, error }); },
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as OutboundQuery;
    return { q, filters };
  }
  it('keeps the newest outbound time per lead, outbound only, tenant-scoped', async () => {
    const { q, filters } = outboundStub([
      { lead_id: 'a', created_at: '2026-10-07T10:00:00Z' },
      { lead_id: 'a', created_at: '2026-10-07T12:00:00Z' },
      { lead_id: 'b', created_at: '2026-10-06T09:00:00Z' },
    ]);
    const m = await fetchLastOutbound(q, 's-1', ['a', 'b']);
    expect(m?.get('a')).toBe('2026-10-07T12:00:00Z');
    expect(m?.get('b')).toBe('2026-10-06T09:00:00Z');
    expect(filters[0].slice(0, 4)).toEqual(['session_id', 's-1', 'direction', 'outbound']);
  });
  it('returns null on a failed read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fetchLastOutbound(outboundStub(null, { message: 'x' }).q, 's', ['a'])).toBeNull();
    spy.mockRestore();
  });
});

describe('fetchPaidByLead', () => {
  it('sums payments per lead, refunds included', async () => {
    const { q } = signalStub(() => ({
      data: [
        { lead_id: 'a', amount_cents: 100_000 },
        { lead_id: 'a', amount_cents: '50000' },
        { lead_id: 'a', amount_cents: -20_000 },
        { lead_id: 'b', amount_cents: 5_000 },
      ],
      error: null,
    }));
    const m = await fetchPaidByLead(q, 's', ['a', 'b']);
    expect(m?.get('a')).toBe(130_000);
    expect(m?.get('b')).toBe(5_000);
  });
  it('returns null when the ledger is missing or unreadable', async () => {
    expect(await fetchPaidByLead(signalStub(() => ({ data: null, error: { message: 'x', code: 'PGRST205' } })).q, 's', ['a'])).toBeNull();
  });
});
