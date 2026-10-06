import { describe, it, expect, vi } from 'vitest';
import { fetchLiveScores, mergeLiveScores, type LiveScoreQuery } from './liveScores';
import type { Lead } from '@/lib/metrics/leads';

const lead = (id: string, score: number | null): Lead => ({
  id, name: null, city: null, service: null, phone: null, source: 'text', referrer_name: null,
  score, status: 'open', quote_cents: null, contacted: true, after_hours: false,
  first_reply_seconds: null, created_at: '2026-10-01T00:00:00.000Z',
});

function stub(result: { data: { lead_id: string; score: number | null }[] | null; error: { message: string } | null }) {
  const calls: unknown[] = [];
  const q: LiveScoreQuery = {
    from: (t) => { calls.push(['from', t]); return {
      select: (c) => { calls.push(['select', c]); return {
        eq: (k, v) => { calls.push(['eq', k, v]); return {
          limit: (n) => { calls.push(['limit', n]); return Promise.resolve(result); },
        }; },
      }; },
    }; },
  };
  return { q, calls };
}

describe('fetchLiveScores', () => {
  it('reads the view for one session only', async () => {
    const { q, calls } = stub({ data: [{ lead_id: 'a', score: 81 }, { lead_id: 'b', score: null }], error: null });
    const live = await fetchLiveScores(q, 's-1');
    expect(calls).toContainEqual(['from', 'client_lead_scores']);
    expect(calls).toContainEqual(['eq', 'session_id', 's-1']);
    expect([...live!.entries()]).toEqual([['a', 81]]);
  });

  it('returns null when the view is unreadable (migration not applied yet)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { q } = stub({ data: null, error: { message: 'relation "client_lead_scores" does not exist' } });
    expect(await fetchLiveScores(q, 's-1')).toBeNull();
    warn.mockRestore();
  });
});

describe('mergeLiveScores', () => {
  it('replaces stored scores with live ones', () => {
    const out = mergeLiveScores([lead('a', 90), lead('b', null)], new Map([['a', 40], ['b', 75]]));
    expect(out.map(l => l.score)).toEqual([40, 75]);
  });

  it('keeps the stored score for a lead the view has no row for', () => {
    expect(mergeLiveScores([lead('a', 66)], new Map()).map(l => l.score)).toEqual([66]);
  });

  it('keeps every stored score when live scores are unavailable', () => {
    const leads = [lead('a', 66), lead('b', null)];
    expect(mergeLiveScores(leads, null)).toBe(leads);
  });
});
