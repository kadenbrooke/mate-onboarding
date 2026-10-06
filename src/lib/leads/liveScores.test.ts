import { describe, it, expect, vi } from 'vitest';
import { fetchLiveScores, mergeLiveScores, SCORE_CHUNK, type LiveScoreQuery, type LiveScores } from './liveScores';
import type { Lead } from '@/lib/metrics/leads';

const lead = (id: string, score: number | null): Lead => ({
  id, name: null, city: null, service: null, phone: null, source: 'text', referrer_name: null,
  score, status: 'open', quote_cents: null, contacted: true, after_hours: false,
  first_reply_seconds: null, created_at: '2026-10-01T00:00:00.000Z',
});

type Resp = { data: { lead_id: string; score: number | null }[] | null; error: { message: string; code?: string } | null };

/** Records every request; answers each from `respond(ids)`. */
function stub(respond: (ids: string[]) => Resp) {
  const requests: { session: string; ids: string[] }[] = [];
  const q: LiveScoreQuery = {
    from: () => ({
      select: () => ({
        eq: (_col, session) => ({
          in: (_c, ids) => { requests.push({ session, ids }); return Promise.resolve(respond(ids)); },
        }),
      }),
    }),
  };
  return { q, requests };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `lead-${i}`);

describe('fetchLiveScores', () => {
  it('reads exactly the loaded ids, chunked, all scoped to the tenant', async () => {
    const all = ids(SCORE_CHUNK * 2 + 37);
    const { q, requests } = stub(chunk => ({ data: chunk.map(id => ({ lead_id: id, score: 50 })), error: null }));
    const live = await fetchLiveScores(q, 's-1', all);
    expect(requests).toHaveLength(3);
    expect(requests.every(r => r.session === 's-1' && r.ids.length <= SCORE_CHUNK)).toBe(true);
    expect(requests.flatMap(r => r.ids)).toEqual(all);
    expect(live.status).toBe('live');
    if (live.status === 'live') expect(live.scores.size).toBe(all.length);
  });

  it('makes no request when no leads were loaded', async () => {
    const { q, requests } = stub(() => ({ data: [], error: null }));
    expect((await fetchLiveScores(q, 's-1', [])).status).toBe('live');
    expect(requests).toHaveLength(0);
  });

  it.each(['PGRST205', '42P01'])('treats %s as "migration not applied yet"', async (code) => {
    const { q } = stub(() => ({ data: null, error: { code, message: 'missing' } }));
    expect(await fetchLiveScores(q, 's-1', ['a'])).toEqual({ status: 'missing' });
  });

  it('logs any other error instead of passing it off as a stored score', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { q } = stub(() => ({ data: null, error: { code: '57014', message: 'statement timeout' } }));
    expect(await fetchLiveScores(q, 's-1', ['a'])).toEqual({ status: 'error' });
    expect(err).toHaveBeenCalledWith(expect.stringContaining('client_lead_scores'), '57014', 'statement timeout');
    err.mockRestore();
  });

  it('one failed chunk fails the whole read', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const all = ids(SCORE_CHUNK + 1);
    const { q } = stub(chunk => chunk.length === 1
      ? { data: null, error: { code: '08006', message: 'connection failure' } }
      : { data: chunk.map(id => ({ lead_id: id, score: 1 })), error: null });
    expect((await fetchLiveScores(q, 's-1', all)).status).toBe('error');
    err.mockRestore();
  });
});

describe('mergeLiveScores', () => {
  const live = (pairs: [string, number | null][]): LiveScores => ({ status: 'live', scores: new Map(pairs) });

  it('replaces stored scores with live ones', () => {
    const out = mergeLiveScores([lead('a', 90), lead('b', null)], live([['a', 40], ['b', 75]]));
    expect(out.map(l => l.score)).toEqual([40, 75]);
  });

  it('never keeps a stale stored score for a lead the view did not return', () => {
    expect(mergeLiveScores([lead('a', 66)], live([])).map(l => l.score)).toEqual([null]);
  });

  it('keeps stored scores only when the view does not exist yet', () => {
    const leads = [lead('a', 66), lead('b', null)];
    expect(mergeLiveScores(leads, { status: 'missing' })).toBe(leads);
  });

  it('shows no score at all, not a stored one, when the read failed', () => {
    expect(mergeLiveScores([lead('a', 66)], { status: 'error' }).map(l => l.score)).toEqual([null]);
  });
});
