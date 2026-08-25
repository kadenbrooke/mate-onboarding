import { describe, it, expect, beforeEach } from 'vitest';
import type { Lead } from '@/lib/metrics/leads';
import { searchLeads, cycleSort, applySort, nextStatus, loadControls, saveControls, parseSortParam, partitionByRecency, type SortEntry } from './leadsControls';

const mk = (o: Partial<Lead>): Lead => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  name: o.name ?? null, city: o.city ?? null, service: o.service ?? null,
  phone: o.phone ?? null, source: o.source ?? 'unknown', referrer_name: null,
  score: o.score ?? null, status: o.status ?? 'open', quote_cents: o.quote_cents ?? null,
  handler: o.handler ?? null,
  contacted: false, after_hours: false, first_reply_seconds: null,
  created_at: o.created_at ?? '2026-07-01T00:00:00Z',
});

describe('searchLeads', () => {
  const leads = [
    mk({ name: 'Jane Doe', city: 'Provo', service: 'Roofing' }),
    mk({ name: 'Bob Smith', city: 'Orem', service: 'Paving', phone: '8015551234' }),
  ];
  it('returns all when query blank', () => {
    expect(searchLeads(leads, '  ')).toHaveLength(2);
  });
  it('matches name case-insensitively', () => {
    expect(searchLeads(leads, 'jane').map(l => l.name)).toEqual(['Jane Doe']);
  });
  it('matches city, service, phone, source substrings', () => {
    expect(searchLeads(leads, 'orem')).toHaveLength(1);
    expect(searchLeads(leads, 'pav')).toHaveLength(1);
    expect(searchLeads(leads, '5551')).toHaveLength(1);
  });
});

describe('cycleSort (3-state: off -> default dir -> flipped -> off)', () => {
  it('adds a key with its default direction on first click', () => {
    expect(cycleSort([], 'score')).toEqual([{ key: 'score', dir: 'desc' }]);
    expect(cycleSort([], 'location')).toEqual([{ key: 'location', dir: 'asc' }]);
    expect(cycleSort([], 'status')).toEqual([{ key: 'status', dir: 'asc' }]);
    expect(cycleSort([], 'quote')).toEqual([{ key: 'quote', dir: 'desc' }]);
    expect(cycleSort([], 'captured')).toEqual([{ key: 'captured', dir: 'desc' }]);
    expect(cycleSort([], 'driver')).toEqual([{ key: 'driver', dir: 'asc' }]);
  });
  it('flips direction on second click', () => {
    expect(cycleSort([{ key: 'score', dir: 'desc' }], 'score')).toEqual([{ key: 'score', dir: 'asc' }]);
  });
  it('removes the key on third click', () => {
    expect(cycleSort([{ key: 'score', dir: 'asc' }], 'score')).toEqual([]);
  });
  it('preserves activation order for other keys (multi-select)', () => {
    let s: SortEntry[] = [];
    s = cycleSort(s, 'score');
    s = cycleSort(s, 'quote');
    expect(s.map(e => e.key)).toEqual(['score', 'quote']);
    s = cycleSort(s, 'score');
    expect(s.map(e => e.key)).toEqual(['score', 'quote']);
  });
});

describe('applySort (compound, priority = activation order)', () => {
  it('no active sort returns input order', () => {
    const leads = [mk({ id: 'a' }), mk({ id: 'b' })];
    expect(applySort(leads, []).map(l => l.id)).toEqual(['a', 'b']);
  });
  it('score desc puts highest first; nulls last', () => {
    const leads = [mk({ id: 'lo', score: 40 }), mk({ id: 'hi', score: 90 }), mk({ id: 'na', score: null })];
    expect(applySort(leads, [{ key: 'score', dir: 'desc' }]).map(l => l.id)).toEqual(['hi', 'lo', 'na']);
  });
  it('status asc orders open > booked > quoted > serviced', () => {
    const leads = [
      mk({ id: 's', status: 'serviced' }),
      mk({ id: 'q', status: 'quoted' }),
      mk({ id: 'o', status: 'open' }),
      mk({ id: 'b', status: 'booked' }),
    ];
    expect(applySort(leads, [{ key: 'status', dir: 'asc' }]).map(l => l.id)).toEqual(['o', 'b', 'q', 's']);
  });
  it('quote desc orders price high to low', () => {
    const leads = [mk({ id: 'c', quote_cents: 100 }), mk({ id: 'a', quote_cents: 900 })];
    expect(applySort(leads, [{ key: 'quote', dir: 'desc' }]).map(l => l.id)).toEqual(['a', 'c']);
  });
  it('compound: status asc then score desc as tiebreaker', () => {
    const leads = [
      mk({ id: 'open-lo', status: 'open', score: 10 }),
      mk({ id: 'open-hi', status: 'open', score: 99 }),
      mk({ id: 'booked', status: 'booked', score: 50 }),
    ];
    expect(applySort(leads, [{ key: 'status', dir: 'asc' }, { key: 'score', dir: 'desc' }]).map(l => l.id))
      .toEqual(['open-hi', 'open-lo', 'booked']);
  });
  it('captured desc (default) puts newest first; null created_at last', () => {
    const nullCap = { ...mk({ id: 'na' }), created_at: null as unknown as string };
    const leads = [
      mk({ id: 'old', created_at: '2026-01-01T00:00:00Z' }),
      mk({ id: 'new', created_at: '2026-08-01T00:00:00Z' }),
      nullCap,
    ];
    expect(applySort(leads, [{ key: 'captured', dir: 'desc' }]).map(l => l.id)).toEqual(['new', 'old', 'na']);
  });
  it('captured asc puts oldest first', () => {
    const leads = [
      mk({ id: 'new', created_at: '2026-08-01T00:00:00Z' }),
      mk({ id: 'old', created_at: '2026-01-01T00:00:00Z' }),
    ];
    expect(applySort(leads, [{ key: 'captured', dir: 'asc' }]).map(l => l.id)).toEqual(['old', 'new']);
  });
  it('driver asc orders agent before human; null handler groups with agent', () => {
    const leads = [
      mk({ id: 'human', handler: 'human' }),
      mk({ id: 'agent', handler: 'agent' }),
      mk({ id: 'legacy', handler: null }),
    ];
    // legacy (null) normalizes to agent, so the two agents lead and human trails.
    const ids = applySort(leads, [{ key: 'driver', dir: 'asc' }]).map(l => l.id);
    expect(ids[2]).toBe('human');
    expect(ids.slice(0, 2).sort()).toEqual(['agent', 'legacy']);
  });
  it('does not mutate the input array', () => {
    const leads = [mk({ id: 'a', score: 1 }), mk({ id: 'b', score: 2 })];
    const before = leads.map(l => l.id);
    applySort(leads, [{ key: 'score', dir: 'desc' }]);
    expect(leads.map(l => l.id)).toEqual(before);
  });
});

describe('nextStatus (stage toggle -> deselect to open)', () => {
  it('selects a stage from the neutral open state', () => {
    expect(nextStatus('open', 'booked')).toBe('booked');
    expect(nextStatus('open', 'quoted')).toBe('quoted');
    expect(nextStatus('open', 'serviced')).toBe('serviced');
  });

  it('clears back to open when the already-set stage is clicked again', () => {
    expect(nextStatus('booked', 'booked')).toBe('open');
    expect(nextStatus('quoted', 'quoted')).toBe('open');
    expect(nextStatus('serviced', 'serviced')).toBe('open');
  });

  it('moves directly between stages, forwards and backwards', () => {
    expect(nextStatus('booked', 'serviced')).toBe('serviced');
    expect(nextStatus('serviced', 'booked')).toBe('booked');
    expect(nextStatus('quoted', 'booked')).toBe('booked');
  });
});

describe('controls persistence (sessionStorage)', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('round-trips query + sort per session', () => {
    saveControls('s1', { query: 'mike', sort: [{ key: 'quote', dir: 'asc' }] });
    expect(loadControls('s1')).toEqual({ query: 'mike', sort: [{ key: 'quote', dir: 'asc' }] });
    expect(loadControls('s2')).toBeNull();
  });

  it('rejects corrupt or foreign shapes instead of crashing', () => {
    window.sessionStorage.setItem('mate:pipeline:controls:v1:s1', 'not json');
    expect(loadControls('s1')).toBeNull();
    window.sessionStorage.setItem('mate:pipeline:controls:v1:s1', JSON.stringify({ query: 1, sort: [] }));
    expect(loadControls('s1')).toBeNull();
    window.sessionStorage.setItem('mate:pipeline:controls:v1:s1', JSON.stringify({ query: '', sort: [{ key: 'nope', dir: 'asc' }] }));
    expect(loadControls('s1')).toBeNull();
  });

  it('dedupes repeated sort keys, keeping first occurrence', () => {
    window.sessionStorage.setItem('mate:pipeline:controls:v1:s1', JSON.stringify({
      query: '', sort: [{ key: 'score', dir: 'asc' }, { key: 'score', dir: 'desc' }, { key: 'status', dir: 'asc' }],
    }));
    expect(loadControls('s1')).toEqual({ query: '', sort: [{ key: 'score', dir: 'asc' }, { key: 'status', dir: 'asc' }] });
  });
});

describe('parseSortParam', () => {
  it('reads a known key with its default direction', () => {
    expect(parseSortParam('captured')).toEqual([{ key: 'captured', dir: 'desc' }]);
    expect(parseSortParam('location')).toEqual([{ key: 'location', dir: 'asc' }]);
  });

  it('honours an explicit direction', () => {
    expect(parseSortParam('captured', 'asc')).toEqual([{ key: 'captured', dir: 'asc' }]);
  });

  it('falls back to the default direction when dir is garbage', () => {
    expect(parseSortParam('captured', 'sideways')).toEqual([{ key: 'captured', dir: 'desc' }]);
  });

  it('returns null for absent or unknown keys', () => {
    expect(parseSortParam(undefined)).toBeNull();
    expect(parseSortParam('nope')).toBeNull();
  });
});

describe('partitionByRecency', () => {
  const NOW = Date.parse('2026-08-25T12:00:00Z');
  const at = (iso: string | null) => mk({ created_at: iso as string });

  it('keeps leads captured inside the window', () => {
    const { recent, older } = partitionByRecency([at('2026-08-20T00:00:00Z')], NOW);
    expect(recent).toHaveLength(1);
    expect(older).toHaveLength(0);
  });

  it('moves leads captured before the cutoff to older', () => {
    const { recent, older } = partitionByRecency([at('2026-06-01T00:00:00Z')], NOW);
    expect(recent).toHaveLength(0);
    expect(older).toHaveLength(1);
  });

  it('treats a lead with no capture date as recent, never buried', () => {
    // mk() coalesces a null created_at to a default, so null it explicitly.
    const undated = { ...mk({}), created_at: null as unknown as string };
    const { recent, older } = partitionByRecency([undated], NOW);
    expect(recent).toHaveLength(1);
    expect(older).toHaveLength(0);
  });

  it('treats an unparseable capture date as recent rather than dropping it', () => {
    const { recent } = partitionByRecency([at('not a date')], NOW);
    expect(recent).toHaveLength(1);
  });

  it('splits a mixed pipeline on the 30-day boundary', () => {
    const { recent, older } = partitionByRecency([
      at('2026-08-24T00:00:00Z'),
      at('2026-08-01T00:00:00Z'),
      at('2026-07-01T00:00:00Z'),
      at('2026-01-01T00:00:00Z'),
    ], NOW);
    expect(recent).toHaveLength(2);
    expect(older).toHaveLength(2);
  });
});
