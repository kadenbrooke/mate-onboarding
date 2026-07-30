import { describe, it, expect } from 'vitest';
import type { Lead } from '@/lib/metrics/leads';
import { searchLeads, cycleSort, applySort, type SortEntry } from './leadsControls';

const mk = (o: Partial<Lead>): Lead => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  name: o.name ?? null, city: o.city ?? null, service: o.service ?? null,
  phone: o.phone ?? null, source: o.source ?? 'unknown', referrer_name: null,
  score: o.score ?? null, status: o.status ?? 'open', quote_cents: o.quote_cents ?? null,
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
  it('status asc orders open > won > lost', () => {
    const leads = [mk({ id: 'l', status: 'lost' }), mk({ id: 'o', status: 'open' }), mk({ id: 'w', status: 'won' })];
    expect(applySort(leads, [{ key: 'status', dir: 'asc' }]).map(l => l.id)).toEqual(['o', 'w', 'l']);
  });
  it('quote desc orders price high to low', () => {
    const leads = [mk({ id: 'c', quote_cents: 100 }), mk({ id: 'a', quote_cents: 900 })];
    expect(applySort(leads, [{ key: 'quote', dir: 'desc' }]).map(l => l.id)).toEqual(['a', 'c']);
  });
  it('compound: status asc then score desc as tiebreaker', () => {
    const leads = [
      mk({ id: 'open-lo', status: 'open', score: 10 }),
      mk({ id: 'open-hi', status: 'open', score: 99 }),
      mk({ id: 'won', status: 'won', score: 50 }),
    ];
    expect(applySort(leads, [{ key: 'status', dir: 'asc' }, { key: 'score', dir: 'desc' }]).map(l => l.id))
      .toEqual(['open-hi', 'open-lo', 'won']);
  });
  it('does not mutate the input array', () => {
    const leads = [mk({ id: 'a', score: 1 }), mk({ id: 'b', score: 2 })];
    const before = leads.map(l => l.id);
    applySort(leads, [{ key: 'score', dir: 'desc' }]);
    expect(leads.map(l => l.id)).toEqual(before);
  });
});
