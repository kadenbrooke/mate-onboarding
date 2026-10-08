import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeQueryDb, type FakeQueryDb } from '@/test/fakeQueryDb';
import {
  fetchCallNow, fetchWaitingCandidates, fetchStuckCandidates, fetchLeadSignals, fetchLastOutbound, fetchPaidByLead,
  CALL_PAGE, CANDIDATE_CAP, REPLY_LOOKBACK_DAYS, type CommandDb,
} from './fetch';

// Practice data only: invented ids and 555 numbers. Two tenants share the
// fake so every test can prove the other tenant's rows never come back.
const A = 'tenant-a';
const B = 'tenant-b';
const NOW = new Date('2026-10-07T15:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
const SIGNAL_COLS = 'lead_id, score, tier, timeframe, last_lead_reply_at';

type Seed = {
  id: string; session_id?: string; score?: number | null; created_at?: string; status?: string;
  job_outcome?: string | null; is_test?: boolean; handler?: string; handler_changed_at?: string | null;
  status_updated_at?: string | null; reply?: string | null; job_value_cents?: number | null;
};

function seed(rows: Seed[], extra: Record<string, Record<string, unknown>[]> = {}): FakeQueryDb {
  const leads = rows.map(r => ({
    id: r.id, session_id: r.session_id ?? A, name: `Practice ${r.id}`, phone: '+18015550100', city: null,
    service: null, source: 'meta', referrer_name: null, score: r.score ?? null, status: r.status ?? 'open',
    quote_cents: null, handler: r.handler ?? 'agent', handler_changed_at: r.handler_changed_at ?? null,
    contacted: true, after_hours: false, first_reply_seconds: null, created_at: r.created_at ?? daysAgo(200),
    status_updated_at: r.status_updated_at ?? null, job_outcome: r.job_outcome ?? null,
    job_value_cents: r.job_value_cents ?? null, is_test: r.is_test ?? false,
  }));
  const scores = rows.filter(r => r.score != null || r.reply).map(r => ({
    lead_id: r.id, session_id: r.session_id ?? A, score: r.score ?? null, tier: null, timeframe: null,
    last_lead_reply_at: r.reply ?? null,
  }));
  return createFakeQueryDb({ client_leads: leads, client_lead_scores: scores, ...extra });
}
const dbOf = (f: FakeQueryDb) => f.client as unknown as CommandDb;

beforeEach(() => { vi.restoreAllMocks(); });

describe('fetchCallNow', () => {
  it('ranks the whole book in SQL: old leads, closed, test and foreign rows handled', async () => {
    const f = seed([
      { id: 'foreign', session_id: B, score: 100 },
      { id: 'test-phone', score: 99, is_test: true },
      { id: 'serviced', score: 98, status: 'serviced' },
      { id: 'won', score: 97, job_outcome: 'won' },
      { id: 'lost', score: 96, job_outcome: 'lost' },
      { id: 'oldest', score: 95, created_at: daysAgo(900) },
      { id: 'b', score: 90 }, { id: 'c', score: 80 }, { id: 'd', score: 70 }, { id: 'e', score: 60 },
      { id: 'f', score: 50 }, { id: 'unscored', score: null },
    ]);
    const r = await fetchCallNow(dbOf(f), A);
    expect(r.status).toBe('live');
    if (r.status !== 'live') return;
    expect(r.leads.map(l => l.id)).toEqual(['oldest', 'b', 'c', 'd', 'e']);
    expect(r.leads[0].score).toBe(95);
    expect(r.scored).toBe(true);
    expect(f.reads[0]).toEqual({
      table: 'client_lead_scores', columns: SIGNAL_COLS,
      where: [`eq session_id ${A}`, 'gte score 0'], order: ['score desc', 'lead_id asc'],
      limit: null, range: [0, CALL_PAGE - 1],
    });
    expect(f.reads[1]).toMatchObject({
      table: 'client_leads', columns: '*',
      where: [`eq session_id ${A}`, 'eq is_test false', expect.stringMatching(/^in id /)],
    });
    expect(f.reads.map(x => x.table)).toEqual(['client_lead_scores', 'client_leads']);
  });

  it('pages past a first page of closed leads', async () => {
    const closed = Array.from({ length: CALL_PAGE }, (_, i) => ({ id: `x${i}`, score: 100 - i * 0.1, status: 'serviced' }));
    const f = seed([...closed, { id: 'open1', score: 40 }, { id: 'open2', score: 30 }]);
    const r = await fetchCallNow(dbOf(f), A);
    expect(r.status === 'live' && r.leads.map(l => l.id)).toEqual(['open1', 'open2']);
    expect(f.reads.filter(x => x.table === 'client_lead_scores').map(x => x.range)).toEqual([[0, CALL_PAGE - 1], [CALL_PAGE, 2 * CALL_PAGE - 1]]);
  });

  it('stops after one page once the top 5 cannot change, but reads on through a tie', async () => {
    const full = Array.from({ length: CALL_PAGE * 3 }, (_, i) => ({ id: `l${i}`, score: 1000 - i }));
    const f1 = seed(full);
    await fetchCallNow(dbOf(f1), A);
    expect(f1.reads.filter(x => x.table === 'client_lead_scores')).toHaveLength(1);

    const tied = Array.from({ length: CALL_PAGE + 1 }, (_, i) => ({ id: `t${String(i).padStart(3, '0')}`, score: 50 }));
    const f2 = seed(tied);
    await fetchCallNow(dbOf(f2), A);
    expect(f2.reads.filter(x => x.table === 'client_lead_scores')).toHaveLength(2);
  });

  it('falls back to the stored score, still tenant-scoped, before the view exists', async () => {
    const f = seed([{ id: 'mine', score: 70 }, { id: 'theirs', session_id: B, score: 99 }]);
    f.failTable('client_lead_scores', { message: 'missing', code: '42P01' });
    const r = await fetchCallNow(dbOf(f), A);
    expect(r.status === 'live' && r.leads.map(l => l.id)).toEqual(['mine']);
    expect(f.reads[1]).toMatchObject({
      table: 'client_leads', where: [`eq session_id ${A}`, 'eq is_test false', 'gte score 0'],
      order: ['score desc', 'id asc'],
    });
  });

  it('reports an error instead of an empty list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = seed([{ id: 'a', score: 70 }]);
    f.failTable('client_lead_scores', { message: 'boom' });
    expect((await fetchCallNow(dbOf(f), A)).status).toBe('error');
  });
});

describe('fetchWaitingCandidates', () => {
  it('gathers arrivals, handoffs and replies of any age lead, this tenant only', async () => {
    const f = seed([
      { id: 'arrived', created_at: hoursAgo(2) },
      { id: 'handed', handler: 'human', handler_changed_at: hoursAgo(10) },
      { id: 'old-reply', created_at: daysAgo(400), reply: daysAgo(20) },
      { id: 'stale-reply', reply: daysAgo(REPLY_LOOKBACK_DAYS + 5) },
      { id: 'quiet', created_at: daysAgo(3) },
      { id: 'foreign-new', session_id: B, created_at: hoursAgo(1), reply: hoursAgo(1) },
      { id: 'test-new', created_at: hoursAgo(1), is_test: true },
      { id: 'test-reply', reply: hoursAgo(1), is_test: true },
    ]);
    const { leads, signals } = await fetchWaitingCandidates(dbOf(f), A, NOW);
    expect(leads.map(l => l.id).sort()).toEqual(['arrived', 'handed', 'old-reply']);
    expect([...signals.keys()].sort()).toEqual(['old-reply']);
    const [arrived, handed, replied] = f.reads;
    expect(arrived).toEqual({
      table: 'client_leads', columns: '*',
      where: [`eq session_id ${A}`, 'eq is_test false', `gte created_at ${hoursAgo(24)}`],
      order: ['created_at desc'], limit: CANDIDATE_CAP, range: null,
    });
    expect(handed.where).toEqual([`eq session_id ${A}`, 'eq is_test false', 'eq handler human', `gte handler_changed_at ${hoursAgo(48)}`]);
    expect(replied).toMatchObject({
      table: 'client_lead_scores', columns: SIGNAL_COLS,
      where: [`eq session_id ${A}`, `gte last_lead_reply_at ${daysAgo(REPLY_LOOKBACK_DAYS)}`],
    });
  });
});

describe('fetchStuckCandidates', () => {
  it('returns every won lead and every stale quote, whatever their age, this tenant only', async () => {
    const f = seed([
      { id: 'won-ancient', job_outcome: 'won', job_value_cents: 500_000, created_at: daysAgo(700) },
      { id: 'won-foreign', session_id: B, job_outcome: 'won', job_value_cents: 900_000 },
      { id: 'won-test', job_outcome: 'won', job_value_cents: 900_000, is_test: true },
      { id: 'stale-stamped', status: 'quoted', status_updated_at: daysAgo(20) },
      { id: 'stale-unstamped', status: 'quoted', status_updated_at: null, created_at: daysAgo(30) },
      { id: 'fresh-quote', status: 'quoted', status_updated_at: daysAgo(5) },
      { id: 'stale-foreign', session_id: B, status: 'quoted', status_updated_at: daysAgo(40) },
    ]);
    const r = await fetchStuckCandidates(dbOf(f), A, NOW);
    expect(r.won?.map(l => l.id)).toEqual(['won-ancient']);
    expect(r.staleQuotes?.map(l => l.id)).toEqual(['stale-stamped', 'stale-unstamped']);
    const cutoff = daysAgo(14);
    expect(f.reads.map(x => x.where)).toEqual([
      [`eq session_id ${A}`, 'eq is_test false', 'eq job_outcome won'],
      [`eq session_id ${A}`, 'eq is_test false', 'eq status quoted', `lt status_updated_at ${cutoff}`],
      [`eq session_id ${A}`, 'eq is_test false', 'eq status quoted', 'is status_updated_at null', `lt created_at ${cutoff}`],
    ]);
  });

  it('marks won leads unknown (not empty) before job outcomes exist', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = seed([]);
    f.failTable('client_leads', { message: 'column job_outcome does not exist', code: '42703' });
    const r = await fetchStuckCandidates(dbOf(f), A, NOW);
    expect(r.won).toBeNull();
    expect(r.staleQuotes).toBeNull();
    expect(err.mock.calls.some(c => String(c[0]).includes('(won)'))).toBe(false);
  });
});

describe('fetchLeadSignals', () => {
  it('reads the given ids for this tenant only', async () => {
    const f = seed([{ id: 'a', score: 70 }, { id: 'a2', session_id: B, score: 10 }]);
    // Same lead id under another tenant must not leak in.
    f.tables.client_lead_scores.push({ lead_id: 'a', session_id: B, score: 1, tier: null, timeframe: null, last_lead_reply_at: null });
    const r = await fetchLeadSignals(dbOf(f), A, ['a', 'a2']);
    expect(r.status === 'live' && [...r.signals.entries()].map(([id, s]) => [id, s.score])).toEqual([['a', 70]]);
    expect(f.reads[0]).toMatchObject({ table: 'client_lead_scores', columns: SIGNAL_COLS, where: [`eq session_id ${A}`, 'in lead_id a,a2'] });
  });
  it('tells a missing view from an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = seed([]);
    f.failTable('client_lead_scores', { message: 'x', code: 'PGRST205' });
    expect((await fetchLeadSignals(dbOf(f), A, ['a'])).status).toBe('missing');
    f.failTable('client_lead_scores', { message: 'boom' });
    expect((await fetchLeadSignals(dbOf(f), A, ['a'])).status).toBe('error');
  });
});

describe('fetchLastOutbound', () => {
  it('finds each lead\'s newest outbound even when another lead is far chattier', async () => {
    const msgs: Record<string, unknown>[] = [];
    for (let i = 0; i < 2500; i++) {
      msgs.push({ lead_id: 'chatty', session_id: A, direction: 'outbound', created_at: hoursAgo(1 + i / 100) });
    }
    msgs.push({ lead_id: 'quiet', session_id: A, direction: 'outbound', created_at: daysAgo(40) });
    msgs.push({ lead_id: 'quiet', session_id: A, direction: 'inbound', created_at: hoursAgo(1) });
    // Another tenant's newer message on the same lead id must be ignored.
    msgs.push({ lead_id: 'quiet', session_id: B, direction: 'outbound', created_at: hoursAgo(0.5) });
    const f = createFakeQueryDb({ lead_messages: msgs });
    const m = await fetchLastOutbound(dbOf(f), A, ['chatty', 'quiet', 'silent']);
    expect(m && Object.fromEntries(m)).toEqual({ chatty: hoursAgo(1), quiet: daysAgo(40) });
    expect(f.reads).toHaveLength(3);
    expect(f.reads[1]).toEqual({
      table: 'lead_messages', columns: 'lead_id, created_at',
      where: [`eq session_id ${A}`, 'eq lead_id quiet', 'eq direction outbound'],
      order: ['created_at desc'], limit: 1, range: null,
    });
  });
  it('returns null on a failed read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = createFakeQueryDb({});
    f.failTable('lead_messages', { message: 'x' });
    expect(await fetchLastOutbound(dbOf(f), A, ['a'])).toBeNull();
  });
});

describe('fetchPaidByLead', () => {
  it('sums this tenant\'s payments for the requested leads only, refunds included', async () => {
    const f = createFakeQueryDb({
      client_lead_payments: [
        { lead_id: 'a', session_id: A, amount_cents: 100_000 },
        { lead_id: 'a', session_id: A, amount_cents: '50000' },
        { lead_id: 'a', session_id: A, amount_cents: -20_000 },
        { lead_id: 'a', session_id: B, amount_cents: 999_999 },
        { lead_id: 'b', session_id: A, amount_cents: 5_000 },
        { lead_id: 'not-asked', session_id: A, amount_cents: 7_000 },
      ],
    });
    const m = await fetchPaidByLead(dbOf(f), A, ['a', 'b']);
    expect(m && Object.fromEntries(m)).toEqual({ a: 130_000, b: 5_000 });
    expect(f.reads).toEqual([{
      table: 'client_lead_payments', columns: 'lead_id, amount_cents',
      where: [`eq session_id ${A}`, 'in lead_id a,b'], order: [], limit: null, range: null,
    }]);
  });
  it('returns null when the ledger is missing or unreadable', async () => {
    const f = createFakeQueryDb({});
    f.failTable('client_lead_payments', { message: 'x', code: 'PGRST205' });
    expect(await fetchPaidByLead(dbOf(f), A, ['a'])).toBeNull();
  });
});
