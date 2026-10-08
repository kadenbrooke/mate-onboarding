import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeQueryDb, type FakeQueryDb } from '@/test/fakeQueryDb';
import {
  fetchOpenBook, fetchWonLeads, fetchLastOutbound, fetchPaidByLead, scanAll,
  PAGE, MAX_PAGES, CHUNK, type CommandDb, type Query,
} from './fetch';
import { callList } from './commandCenter';

// Practice data only: invented ids and 555 numbers. Two tenants share the
// fake so every test can prove the other tenant's rows never come back. The
// fake caps every response at 1000 rows, like Supabase's PostgREST.
const A = 'tenant-a';
const B = 'tenant-b';
const NOW = new Date('2026-10-07T15:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
const SIGNAL_COLS = 'lead_id, score, tier, timeframe, last_lead_reply_at';
const OPEN_WHERE = [`eq session_id ${A}`, 'eq is_test false', 'neq status serviced', 'is job_outcome null'];
const pad = (i: number) => String(i).padStart(5, '0');

type Seed = {
  id: string; session_id?: string; score?: number | null; created_at?: string; status?: string;
  job_outcome?: string | null; is_test?: boolean; reply?: string | null; job_value_cents?: number | null;
};

function seed(rows: Seed[], extra: Record<string, Record<string, unknown>[]> = {}): FakeQueryDb {
  const leads = rows.map(r => ({
    id: r.id, session_id: r.session_id ?? A, name: `Practice ${r.id}`, phone: '+18015550100', city: null,
    service: null, source: 'meta', referrer_name: null, score: null, status: r.status ?? 'open',
    quote_cents: null, handler: 'agent', handler_changed_at: null, contacted: true, after_hours: false,
    first_reply_seconds: null, created_at: r.created_at ?? daysAgo(200), status_updated_at: null,
    job_outcome: r.job_outcome ?? null, job_value_cents: r.job_value_cents ?? null, is_test: r.is_test ?? false,
  }));
  const scores = rows.filter(r => r.score != null || r.reply).map(r => ({
    lead_id: r.id, session_id: r.session_id ?? A, score: r.score ?? null, tier: null, timeframe: null,
    last_lead_reply_at: r.reply ?? null,
  }));
  return createFakeQueryDb({ client_leads: leads, client_lead_scores: scores, ...extra });
}
const dbOf = (f: FakeQueryDb) => f.client as unknown as CommandDb;
const ids = (xs: { id: string }[]) => xs.map(x => x.id);

beforeEach(() => { vi.restoreAllMocks(); });

describe('scanAll', () => {
  it('pages past the 1000-row response cap and reports a hit ceiling', async () => {
    const rows = Array.from({ length: PAGE * MAX_PAGES + 1 }, (_, i) => ({ id: pad(i) }));
    const f = createFakeQueryDb({ t: rows });
    const scan = await scanAll(() => (dbOf(f).from('t').select('id') as Query<Record<string, unknown>>).order('id', { ascending: true }));
    expect('rows' in scan && scan.rows.length).toBe(PAGE * MAX_PAGES);
    expect('rows' in scan && scan.complete).toBe(false);
    expect(f.reads).toHaveLength(MAX_PAGES);
  });
});

describe('fetchOpenBook', () => {
  it('filters eligibility in SQL and reads this tenant\'s open leads with their live scores', async () => {
    const f = seed([
      { id: 'open', score: 80, reply: hoursAgo(2) },
      { id: 'serviced', score: 99, status: 'serviced' },
      { id: 'won', score: 98, job_outcome: 'won' },
      { id: 'lost', score: 97, job_outcome: 'lost' },
      { id: 'test', score: 96, is_test: true },
      { id: 'foreign', session_id: B, score: 95 },
    ]);
    const book = await fetchOpenBook(dbOf(f), A);
    expect(book && ids(book.leads)).toEqual(['open']);
    expect(book?.leads[0].score).toBe(80);
    expect(book?.signals.get('open')?.last_lead_reply_at).toBe(hoursAgo(2));
    expect(book?.complete).toBe(true);
    expect(f.reads[0]).toEqual({
      table: 'client_leads', columns: '*', where: OPEN_WHERE, order: ['id asc'], limit: null, range: [0, PAGE - 1],
    });
    expect(f.reads[1]).toMatchObject({ table: 'client_lead_scores', columns: SIGNAL_COLS, where: [`eq session_id ${A}`, 'in lead_id open'] });
  });

  it('reads every open lead past 1000 rows, and Call now ranks the whole book', async () => {
    const n = 2345;
    const many = Array.from({ length: n }, (_, i) => ({ id: `o${pad(i)}`, score: 10 }));
    // The real top 5 sit at the very end of the id order.
    for (let k = 0; k < 5; k++) many[n - 1 - k].score = 90 - k;
    const f = seed(many);
    const book = await fetchOpenBook(dbOf(f), A);
    expect(book?.leads).toHaveLength(n);
    expect(book?.complete).toBe(true);
    expect(f.reads.filter(r => r.table === 'client_leads')).toHaveLength(3);
    expect(f.reads.filter(r => r.table === 'client_lead_scores')).toHaveLength(Math.ceil(n / CHUNK));
    expect(callList(book!.leads).map(l => l.score)).toEqual([90, 89, 88, 87, 86]);
  });

  it('never lets closed rows displace open ones', async () => {
    const closed = Array.from({ length: 1500 }, (_, i) => ({
      id: `c${pad(i)}`, score: 99, ...(i % 3 === 0 ? { status: 'serviced' } : { job_outcome: i % 3 === 1 ? 'won' : 'lost' }),
    }));
    const f = seed([...closed, { id: 'z-open1', score: 20 }, { id: 'z-open2', score: 10 }]);
    const book = await fetchOpenBook(dbOf(f), A);
    expect(book && ids(book.leads)).toEqual(['z-open1', 'z-open2']);
    expect(f.reads.filter(r => r.table === 'client_leads')).toHaveLength(1);
  });

  it('settles a >500-way tie by recency over the whole book', async () => {
    const tied = Array.from({ length: 1200 }, (_, i) => ({ id: `t${pad(i)}`, score: 70, created_at: daysAgo(1200 - i) }));
    tied[3].score = 71; // one lead just above the tie, early in id order
    const f = seed(tied);
    const book = await fetchOpenBook(dbOf(f), A);
    expect(ids(callList(book!.leads))).toEqual(['t00003', 't01199', 't01198', 't01197', 't01196']);
  });

  it('runs without the job_outcome predicate before 0021, still tenant-scoped', async () => {
    const f = seed([{ id: 'mine', score: 50 }, { id: 'theirs', session_id: B, score: 60 }]);
    f.failIf(r => (r.where.some(w => w.includes('job_outcome')) ? { message: 'no column', code: '42703' } : null));
    const book = await fetchOpenBook(dbOf(f), A);
    expect(book && ids(book.leads)).toEqual(['mine']);
    expect(f.reads[1].where).toEqual([`eq session_id ${A}`, 'eq is_test false', 'neq status serviced']);
  });

  it('keeps stored scores before the view exists and blanks them on a view error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = seed([{ id: 'a' }]);
    missing.tables.client_leads[0].score = 42;
    missing.failTable('client_lead_scores', { message: 'x', code: '42P01' });
    expect((await fetchOpenBook(dbOf(missing), A))?.leads[0].score).toBe(42);
    const broken = seed([{ id: 'a' }]);
    broken.tables.client_leads[0].score = 42;
    broken.failTable('client_lead_scores', { message: 'boom' });
    expect((await fetchOpenBook(dbOf(broken), A))?.leads[0].score).toBeNull();
  });

  it('returns null on a failed lead read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = seed([{ id: 'a' }]);
    f.failTable('client_leads', { message: 'boom' });
    expect(await fetchOpenBook(dbOf(f), A)).toBeNull();
  });
});

describe('fetchWonLeads', () => {
  it('reads every won lead of any age, this tenant only, past 1000 rows', async () => {
    const won = Array.from({ length: 1100 }, (_, i) => ({ id: `w${pad(i)}`, job_outcome: 'won', created_at: daysAgo(900) }));
    const f = seed([...won, { id: 'x-foreign', session_id: B, job_outcome: 'won' }, { id: 'x-test', job_outcome: 'won', is_test: true }]);
    const r = await fetchWonLeads(dbOf(f), A);
    expect(r?.leads).toHaveLength(1100);
    expect(r?.complete).toBe(true);
    expect(f.reads[0].where).toEqual([`eq session_id ${A}`, 'eq is_test false', 'eq job_outcome won']);
  });
  it('is null (and quiet) before job outcomes exist', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = seed([]);
    f.failTable('client_leads', { message: 'no column', code: '42703' });
    expect(await fetchWonLeads(dbOf(f), A)).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });
});

describe('fetchLastOutbound', () => {
  it('finds each lead\'s newest outbound after `since`, however chatty another lead is', async () => {
    const msgs: Record<string, unknown>[] = [];
    for (let i = 0; i < 2500; i++) {
      msgs.push({ id: `m${pad(i)}`, lead_id: 'chatty', session_id: A, direction: 'outbound', created_at: hoursAgo(1 + i / 100) });
    }
    msgs.push({ id: 'q1', lead_id: 'quiet', session_id: A, direction: 'outbound', created_at: daysAgo(4) });
    msgs.push({ id: 'q2', lead_id: 'quiet', session_id: A, direction: 'inbound', created_at: hoursAgo(1) });
    msgs.push({ id: 'q3', lead_id: 'quiet', session_id: B, direction: 'outbound', created_at: hoursAgo(0.5) });
    msgs.push({ id: 'o1', lead_id: 'old', session_id: A, direction: 'outbound', created_at: daysAgo(30) });
    const f = createFakeQueryDb({ lead_messages: msgs });
    const m = await fetchLastOutbound(dbOf(f), A, ['chatty', 'quiet', 'old', 'silent'], daysAgo(10));
    expect(m && Object.fromEntries(m)).toEqual({ chatty: hoursAgo(1), quiet: daysAgo(4) });
    expect(f.reads).toHaveLength(3);
    expect(f.reads[0]).toEqual({
      table: 'lead_messages', columns: 'id, lead_id, created_at',
      where: [`eq session_id ${A}`, 'in lead_id chatty,quiet,old,silent', 'eq direction outbound', `gt created_at ${daysAgo(10)}`],
      order: ['lead_id asc', 'created_at desc', 'id asc'], limit: null, range: [0, PAGE - 1],
    });
  });
  it('returns null on a failed read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = createFakeQueryDb({});
    f.failTable('lead_messages', { message: 'x' });
    expect(await fetchLastOutbound(dbOf(f), A, ['a'], daysAgo(1))).toBeNull();
  });
});

describe('fetchPaidByLead', () => {
  it('sums this tenant\'s payments for the requested leads only, paged, refunds included', async () => {
    const rows: Record<string, unknown>[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `p${pad(i)}`, lead_id: 'a', session_id: A, amount_cents: 100,
    }));
    rows.push(
      { id: 'r1', lead_id: 'a', session_id: A, amount_cents: '-20000' },
      { id: 'f1', lead_id: 'a', session_id: B, amount_cents: 999_999 },
      { id: 'b1', lead_id: 'b', session_id: A, amount_cents: 5_000 },
      { id: 'n1', lead_id: 'not-asked', session_id: A, amount_cents: 7_000 },
    );
    const f = createFakeQueryDb({ client_lead_payments: rows });
    const m = await fetchPaidByLead(dbOf(f), A, ['a', 'b']);
    expect(m && Object.fromEntries(m)).toEqual({ a: 100_000, b: 5_000 });
    expect(f.reads[0]).toEqual({
      table: 'client_lead_payments', columns: 'id, lead_id, amount_cents',
      where: [`eq session_id ${A}`, 'in lead_id a,b'], order: ['id asc'], limit: null, range: [0, PAGE - 1],
    });
    expect(f.reads).toHaveLength(2);
  });
  it('returns null when the ledger is missing', async () => {
    const f = createFakeQueryDb({});
    f.failTable('client_lead_payments', { message: 'x', code: 'PGRST205' });
    expect(await fetchPaidByLead(dbOf(f), A, ['a'])).toBeNull();
  });
});
