import { describe, it, expect } from 'vitest';
import type { Lead } from '@/lib/metrics/leads';
import { summarizeReturn, type SourceRevenueRow } from '@/lib/metrics/revenue';
import {
  ago, telHref, hotReasons, callList, waitingOnMe, stuckList, booksSummary, buildCommandModel, isClosed,
  outboundCandidates, owedTotal,
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

  it('leaves opted-out leads off Call now and admits them when the latch clears', () => {
    const blocked = lead({ id: 'blocked', phone: '+18015550100', score: 99 });
    const live = lead({ id: 'live', phone: '+18015550101', score: 80 });
    const optedOut = new Set(['+18015550100']);
    expect(callList([blocked, live], optedOut).map(l => l.id)).toEqual(['live']);
    optedOut.delete('+18015550100');
    expect(callList([blocked, live], optedOut).map(l => l.id)).toEqual(['blocked', 'live']);
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
  it('counts a quote exactly 14 days old as stuck, and one a minute younger as not', () => {
    const exactly = lead({ status: 'quoted', status_updated_at: daysAgo(14) });
    const younger = lead({ status: 'quoted', status_updated_at: new Date(NOW.getTime() - 14 * 86_400_000 + 60_000).toISOString() });
    const items = stuckList([exactly, younger], new Map(), NOW);
    expect(items.map(i => [i.lead.id, i.kind === 'quote_stale' ? i.days : null])).toEqual([[exactly.id, 14]]);
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
  it('carries the view totals, the passed owed sum and the Meta return, never the partner share', () => {
    const books = booksSummary(summarizeReturn(ROWS, { metaSpend30dCents: 200_000 }), 450_000);
    expect(books).toEqual({
      won: 5, soldCents: 3_300_000, collectedCents: 2_700_000, owedCents: 450_000, hasOutcomes: true,
      sources: [
        { source: 'meta', leads: 40, won: 3, collectedCents: 1_800_000 },
        { source: 'referral', leads: 4, won: 2, collectedCents: 900_000 },
      ],
      metaReturn: 3,
    });
    expect(Object.keys(books)).not.toContain('partner');
  });
  it('keeps an unknown owed amount unknown', () => {
    expect(booksSummary(summarizeReturn(ROWS), null).owedCents).toBeNull();
  });
});

describe('owedTotal', () => {
  it('sums each job\'s own balance, so an overpaid job never hides another\'s', () => {
    const over = lead({ job_outcome: 'won', job_value_cents: 300_000 });
    const owing = lead({ job_outcome: 'won', job_value_cents: 500_000 });
    const stuck = stuckList([over, owing], new Map([[over.id, 450_000], [owing.id, 100_000]]), NOW);
    // Account-wide sold minus collected would be 800k - 550k = 250k.
    expect(owedTotal(stuck)).toBe(400_000);
  });
});

describe('outboundCandidates', () => {
  it('picks open human-handled leads that texted in, from the earliest such text', () => {
    const a = lead({ handler: 'human' });
    const b = lead({ handler: 'human' });
    const agent = lead();
    const closed = lead({ handler: 'human', job_outcome: 'won' });
    const silent = lead({ handler: 'human' });
    const r = outboundCandidates([a, b, agent, closed, silent], signalsOf(
      sig(a, { last_lead_reply_at: hoursAgo(3) }), sig(b, { last_lead_reply_at: daysAgo(90) }),
      sig(agent, { last_lead_reply_at: hoursAgo(1) }), sig(closed, { last_lead_reply_at: hoursAgo(1) }),
    ));
    expect(r).toEqual({ ids: [a.id, b.id], since: daysAgo(90) });
  });
  it('has nothing to read when no one qualifies', () => {
    expect(outboundCandidates([lead()], new Map())).toEqual({ ids: [], since: null });
  });
});

const model = (over: Partial<Parameters<typeof buildCommandModel>[0]>) => buildCommandModel({
  sessionId: 's-1', openLeads: [], wonLeads: [], signals: new Map(), complete: { open: true, won: true, paid: true },
  lastOutbound: new Map(), paidByLead: new Map(), summary: null, now: NOW, label: l => l.name ?? '', ...over,
});

describe('buildCommandModel', () => {
  it('builds display rows with thread links and tel links', () => {
    const hot = lead({ score: 88, phone: '(801) 555-0123', created_at: hoursAgo(3) });
    const m = model({ openLeads: [hot], signals: signalsOf(sig(hot)) });
    expect(m.call[0]).toMatchObject({
      id: hot.id, score: 88, tel: 'tel:+18015550123', href: `/dash/s-1/pipeline?spotlight=${hot.id}`,
      reasons: ['New lead'],
    });
    expect(m.waiting.rows[0]).toMatchObject({ kind: 'new', when: '3h' });
    expect(m.books).toBeNull();
    expect(m.scored).toBe(true);
    expect(m.incomplete).toEqual({ call: false, waiting: false, stuck: false, books: false });
  });
  it('caps the waiting list and reports the rest', () => {
    const leads = Array.from({ length: WAIT_ROWS + 3 }, () => lead({ created_at: hoursAgo(1), score: null }));
    const m = model({ openLeads: leads });
    expect(m.waiting.rows).toHaveLength(WAIT_ROWS);
    expect(m.waiting.more).toBe(3);
    expect(m.waiting.counts.new).toBe(WAIT_ROWS + 3);
    expect(m.scored).toBe(false);
  });
  it('says nobody to call (not scoring off) when nothing is open', () => {
    expect(model({}).scored).toBe(true);
  });
  it('puts owed won jobs and stale open quotes in Stuck', () => {
    const won = lead({ job_outcome: 'won', job_value_cents: 400_000 });
    const quote = lead({ status: 'quoted', status_updated_at: daysAgo(15) });
    const m = model({ openLeads: [quote], wonLeads: [won] });
    expect(m.stuck.rows.map(r => r.label)).toEqual(['Owes $4,000', 'Quote 15d']);
  });
  it('flags cards whose reads were cut short or failed', () => {
    expect(model({ complete: { open: false, won: true, paid: true } }).incomplete)
      .toEqual({ call: true, waiting: true, stuck: true, books: false });
  });
  it('makes To collect match the Stuck rows, across a cross-job overpayment', () => {
    const over = lead({ job_outcome: 'won', job_value_cents: 300_000 });
    const owing = lead({ job_outcome: 'won', job_value_cents: 500_000 });
    const m = model({
      wonLeads: [over, owing], paidByLead: new Map([[over.id, 450_000], [owing.id, 100_000]]),
      summary: summarizeReturn(ROWS),
    });
    expect(m.stuck.rows.map(r => r.label)).toEqual(['Owes $4,000']);
    expect(m.books?.owedCents).toBe(400_000);
    expect(m.incomplete.books).toBe(false);
  });
  for (const [why, complete, paid] of [
    ['won-lead read failed or capped', { open: true, won: false, paid: true }, new Map<string, number>()],
    ['payment read failed or capped', { open: true, won: true, paid: false }, null],
  ] as const) {
    it(`leaves money owed unknown, never "nothing stuck", when the ${why}`, () => {
      const owing = lead({ job_outcome: 'won', job_value_cents: 500_000 });
      const m = model({ wonLeads: [owing], complete, paidByLead: paid, summary: summarizeReturn(ROWS) });
      expect(m.stuck.rows).toEqual([]);
      expect(m.books?.owedCents).toBeNull();
      expect(m.incomplete).toMatchObject({ stuck: true, books: true });
    });
  }
});

describe('isClosed', () => {
  it('is serviced, won or lost', () => {
    expect(isClosed(lead({ status: 'serviced' }))).toBe(true);
    expect(isClosed(lead({ job_outcome: 'won' }))).toBe(true);
    expect(isClosed(lead({ job_outcome: 'lost' }))).toBe(true);
    expect(isClosed(lead({ status: 'quoted' }))).toBe(false);
  });
});
