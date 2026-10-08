import { describe, it, expect } from 'vitest';
import type { Lead } from '@/lib/metrics/leads';
import { summarizeReturn, type SourceRevenueRow } from '@/lib/metrics/revenue';
import {
  ago, telHref, hotReasons, callList, waitingOnMe, stuckList, booksSummary, buildCommandModel, isClosed,
  WAIT_ROWS, type LeadSignal,
} from './commandCenter';

// Fake practice leads only: invented names, 555 numbers.
const NOW = new Date('2026-10-07T15:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

let n = 0;
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: `lead-${++n}`, name: `Practice Lead ${n}`, city: 'Orem', service: 'Driveway', phone: '+18015550100',
  source: 'meta', referrer_name: null, score: 50, status: 'open', quote_cents: null, handler: 'agent',
  contacted: true, after_hours: false, first_reply_seconds: null, created_at: daysAgo(10),
  job_outcome: null, job_value_cents: null, ...over,
});
const sig = (l: Lead, over: Partial<LeadSignal> = {}): LeadSignal => ({
  lead_id: l.id, score: l.score, tier: null, timeframe: null, last_lead_reply_at: null, ...over,
});
const signalsOf = (...s: LeadSignal[]) => new Map(s.map(x => [x.lead_id, x]));

describe('ago', () => {
  it('reads minutes, hours, days, weeks', () => {
    expect(ago(hoursAgo(0), NOW)).toBe('now');
    expect(ago(hoursAgo(0.5), NOW)).toBe('30m');
    expect(ago(hoursAgo(5), NOW)).toBe('5h');
    expect(ago(daysAgo(3), NOW)).toBe('3d');
    expect(ago(daysAgo(21), NOW)).toBe('3w');
  });
  it('treats a future time as now and junk as empty', () => {
    expect(ago(hoursAgo(-2), NOW)).toBe('now');
    expect(ago('not a date', NOW)).toBe('');
  });
});

describe('telHref', () => {
  it('links plain US numbers only', () => {
    expect(telHref('+1 (801) 555-0100')).toBe('tel:+18015550100');
    expect(telHref('8015550100')).toBe('tel:+18015550100');
    expect(telHref('555-0100')).toBeNull();
    expect(telHref('+44 20 7946 0958')).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe('hotReasons', () => {
  it('leads with reply recency, then urgency, caps at two', () => {
    const l = lead({ quote_cents: 1_200_000, created_at: hoursAgo(5) });
    const r = hotReasons(l, sig(l, { last_lead_reply_at: hoursAgo(2), timeframe: 'asap please', tier: '1' }), NOW);
    expect(r).toEqual(['Replied 2h ago', 'Wants it soon']);
  });
  it('names a big quote, proximity and freshness when there is no reply', () => {
    const l = lead({ quote_cents: 1_200_000, created_at: hoursAgo(5) });
    expect(hotReasons(l, sig(l, { tier: '1' }), NOW)).toEqual(['$12.0k job', 'Close by']);
  });
  it('ignores an old reply and a far-off timeframe', () => {
    const l = lead();
    expect(hotReasons(l, sig(l, { last_lead_reply_at: daysAgo(5), timeframe: 'next spring' }), NOW)).toEqual([]);
  });
  it('says just now for a reply this minute', () => {
    const l = lead();
    expect(hotReasons(l, sig(l, { last_lead_reply_at: hoursAgo(0) }), NOW)[0]).toBe('Replied just now');
  });
});

describe('callList', () => {
  it('is the top 5 by score, skipping serviced, won and lost leads', () => {
    const won = lead({ score: 99, job_outcome: 'won' });
    const lost = lead({ score: 98, job_outcome: 'lost' });
    const serviced = lead({ score: 97, status: 'serviced' });
    const open = [90, 80, 70, 60, 55, 40].map(score => lead({ score }));
    const list = callList([won, lost, serviced, ...open]);
    expect(list.map(l => l.score)).toEqual([90, 80, 70, 60, 55]);
  });
  it('leaves unscored leads off', () => {
    expect(callList([lead({ score: null })])).toEqual([]);
  });
});

describe('waitingOnMe', () => {
  it('flags a handed-off lead whose last text has no answer', () => {
    const l = lead({ handler: 'human', handler_changed_at: daysAgo(10) });
    const out = new Map([[l.id, hoursAgo(6)]]);
    const { items, counts } = waitingOnMe([l], signalsOf(sig(l, { last_lead_reply_at: hoursAgo(3) })), out, NOW);
    expect(items).toEqual([{ lead: l, kind: 'handed', at: hoursAgo(3) }]);
    expect(counts).toEqual({ handed: 1, replied: 0, new: 0 });
  });
  it('drops a handed-off lead once a person answered and the handoff is old', () => {
    const l = lead({ handler: 'human', handler_changed_at: daysAgo(10) });
    const out = new Map([[l.id, hoursAgo(1)]]);
    expect(waitingOnMe([l], signalsOf(sig(l, { last_lead_reply_at: hoursAgo(3) })), out, NOW).items).toEqual([]);
  });
  it('shows a fresh handoff even before the lead texts again', () => {
    const l = lead({ handler: 'human', handler_changed_at: hoursAgo(20) });
    expect(waitingOnMe([l], new Map(), new Map(), NOW).items[0]?.kind).toBe('handed');
  });
  it('counts every human reply as unanswered when outbound times are unknown', () => {
    const l = lead({ handler: 'human', handler_changed_at: daysAgo(10) });
    const { items } = waitingOnMe([l], signalsOf(sig(l, { last_lead_reply_at: daysAgo(4) })), null, NOW);
    expect(items[0]?.kind).toBe('handed');
  });
  it('shows an agent-handled reply for 24 hours only', () => {
    const fresh = lead();
    const stale = lead();
    const { items } = waitingOnMe([fresh, stale], signalsOf(
      sig(fresh, { last_lead_reply_at: hoursAgo(2) }),
      sig(stale, { last_lead_reply_at: hoursAgo(30) }),
    ), new Map(), NOW);
    expect(items.map(i => [i.lead.id, i.kind])).toEqual([[fresh.id, 'replied']]);
  });
  it('shows leads that arrived in the last 24 hours as new', () => {
    const a = lead({ created_at: hoursAgo(2) });
    const b = lead({ created_at: hoursAgo(26) });
    expect(waitingOnMe([a, b], new Map(), new Map(), NOW).items.map(i => i.lead.id)).toEqual([a.id]);
  });
  it('puts each lead in one bucket and never a closed one', () => {
    const both = lead({ created_at: hoursAgo(1) });
    const closed = lead({ created_at: hoursAgo(1), job_outcome: 'lost' });
    const { items } = waitingOnMe([both, closed], signalsOf(sig(both, { last_lead_reply_at: hoursAgo(0.5) })), new Map(), NOW);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('replied');
  });
  it('sorts handed, then replied, then new, newest first in each', () => {
    const newer = lead({ created_at: hoursAgo(1) });
    const older = lead({ created_at: hoursAgo(5) });
    const replied = lead();
    const handed = lead({ handler: 'human', handler_changed_at: hoursAgo(40) });
    const { items } = waitingOnMe([older, newer, replied, handed],
      signalsOf(sig(replied, { last_lead_reply_at: hoursAgo(10) })), new Map(), NOW);
    expect(items.map(i => i.lead.id)).toEqual([handed.id, replied.id, newer.id, older.id]);
  });
});

describe('stuckList', () => {
  it('lists won jobs that still owe money, biggest first', () => {
    const small = lead({ job_outcome: 'won', job_value_cents: 300_000 });
    const big = lead({ job_outcome: 'won', job_value_cents: 900_000, status: 'serviced' });
    const paid = lead({ job_outcome: 'won', job_value_cents: 500_000 });
    const items = stuckList([small, big, paid], new Map([[big.id, 100_000], [paid.id, 500_000]]), NOW);
    expect(items.map(i => [i.lead.id, i.kind === 'owed' ? i.owedCents : null])).toEqual([
      [big.id, 800_000], [small.id, 300_000],
    ]);
  });
  it('shows no money owed when payments could not be read', () => {
    const won = lead({ job_outcome: 'won', job_value_cents: 300_000 });
    expect(stuckList([won], null, NOW)).toEqual([]);
  });
  it('counts a lead once when merged query results repeat it', () => {
    const won = lead({ job_outcome: 'won', job_value_cents: 300_000, status: 'quoted' });
    expect(stuckList([won, won], new Map(), NOW)).toHaveLength(1);
  });
  it('lists quotes with no answer after 14 days, oldest first', () => {
    const q20 = lead({ status: 'quoted', status_updated_at: daysAgo(20) });
    const q30 = lead({ status: 'quoted', status_updated_at: daysAgo(30) });
    const q5 = lead({ status: 'quoted', status_updated_at: daysAgo(5) });
    const decided = lead({ status: 'quoted', status_updated_at: daysAgo(40), job_outcome: 'lost' });
    const items = stuckList([q20, q30, q5, decided], new Map(), NOW);
    expect(items.map(i => [i.lead.id, i.kind === 'quote_stale' ? i.days : null])).toEqual([[q30.id, 30], [q20.id, 20]]);
  });
  it('falls back to arrival time for a quote with no status stamp', () => {
    const q = lead({ status: 'quoted', status_updated_at: null, created_at: daysAgo(15) });
    expect(stuckList([q], new Map(), NOW)).toHaveLength(1);
  });
});

const ROWS: SourceRevenueRow[] = [
  { source: 'meta', leads: 40, won: 3, lost: 5, job_value_cents: 2_400_000, collected_cents: 1_800_000, collected_in_window_cents: 1_800_000, collected_30d_cents: 600_000 },
  { source: 'referral', leads: 4, won: 2, lost: 0, job_value_cents: 900_000, collected_cents: 900_000, collected_in_window_cents: 0, collected_30d_cents: 0 },
  { source: 'google', leads: 0, won: 0, lost: 0, job_value_cents: 0, collected_cents: 0, collected_in_window_cents: 0, collected_30d_cents: 0 },
];

describe('booksSummary', () => {
  it('carries totals, sources with leads and the Meta return, never the partner share', () => {
    const owed = lead({ job_outcome: 'won', job_value_cents: 500_000 });
    const stuck = stuckList([owed], new Map(), NOW);
    const books = booksSummary(summarizeReturn(ROWS, { metaSpend30dCents: 200_000 }), stuck, true);
    expect(books).toEqual({
      won: 5, soldCents: 3_300_000, collectedCents: 2_700_000, owedCents: 500_000, hasOutcomes: true,
      sources: [
        { source: 'meta', leads: 40, won: 3, collectedCents: 1_800_000 },
        { source: 'referral', leads: 4, won: 2, collectedCents: 900_000 },
      ],
      metaReturn: 3,
    });
    expect(Object.keys(books)).not.toContain('partner');
  });
  it('has no owed figure when payments are unknown', () => {
    expect(booksSummary(summarizeReturn(ROWS), [], false).owedCents).toBeNull();
  });
});

describe('buildCommandModel', () => {
  it('builds display rows with thread links and tel links', () => {
    const hot = lead({ score: 88, phone: '(801) 555-0123', created_at: hoursAgo(3) });
    const model = buildCommandModel({
      sessionId: 's-1', callLeads: [hot], scored: true, waitLeads: [hot], stuckLeads: [],
      signals: signalsOf(sig(hot)), lastOutbound: new Map(), paidByLead: new Map(),
      summary: null, now: NOW, label: l => l.name ?? '',
    });
    expect(model.call[0]).toMatchObject({
      id: hot.id, score: 88, tel: 'tel:+18015550123', href: `/dash/s-1/pipeline?spotlight=${hot.id}`,
      reasons: ['New lead'],
    });
    expect(model.waiting.rows[0]).toMatchObject({ kind: 'new', when: '3h' });
    expect(model.books).toBeNull();
    expect(model.scored).toBe(true);
  });
  it('caps the waiting list and reports the rest', () => {
    const leads = Array.from({ length: WAIT_ROWS + 3 }, () => lead({ created_at: hoursAgo(1), score: null }));
    const model = buildCommandModel({
      sessionId: 's-1', callLeads: [], scored: false, waitLeads: leads, stuckLeads: [],
      signals: new Map(), lastOutbound: new Map(), paidByLead: new Map(),
      summary: null, now: NOW, label: l => l.name ?? '',
    });
    expect(model.waiting.rows).toHaveLength(WAIT_ROWS);
    expect(model.waiting.more).toBe(3);
    expect(model.waiting.counts.new).toBe(WAIT_ROWS + 3);
    expect(model.scored).toBe(false);
  });
});

describe('isClosed', () => {
  it('is serviced, won or lost', () => {
    expect(isClosed(lead({ status: 'serviced' }))).toBe(true);
    expect(isClosed(lead({ job_outcome: 'won' }))).toBe(true);
    expect(isClosed(lead({ job_outcome: 'lost' }))).toBe(true);
    expect(isClosed(lead({ status: 'quoted' }))).toBe(false);
  });
});
