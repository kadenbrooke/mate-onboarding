// @vitest-environment node
//
// Runs migration 0021 in a real Postgres (PGlite, in-process) and checks:
//   1. recording a won job with collected cash (the same UPDATE the outcome
//      route sends) moves that source's return in client_lead_revenue_by_source
//      and the 15% partner figure built from it, and leaves status alone,
//   2. the view agrees with the TypeScript twin (revenueRowsFromLeads),
//      including the 24-month and 30-day edges,
//   3. the CHECKs and the outcome_at / collected_at stamping,
//   4. client_leads.session_id cannot change after insert, while the n8n
//      "Ensure Lead SMS" upsert shape (ON CONFLICT (session_id, phone) DO
//      UPDATE) still works,
//   5. anon / authenticated are denied the view and service_role can read it.
//
// Only invented practice rows are seeded. The tables are minimal stand-ins
// with the live column names and types the migration reads.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { revenueRowsFromLeads, summarizeReturn, type SourceRevenueRow } from './revenue';
import type { Lead } from './leads';

const MIGRATION = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0021_lead_job_outcome.sql'), 'utf8',
);

const SCHEMA = `
  set timezone = 'UTC';
  create role anon; create role authenticated; create role service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table onboarding_sessions (id uuid primary key);
  create table client_leads (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references onboarding_sessions(id) on delete cascade,
    name text, phone text,
    source text not null default 'text',
    status text not null default 'open' check (status in ('open','booked','quoted','serviced')),
    quote_cents bigint check (quote_cents >= 0),
    is_test boolean not null default false,
    capi_pushed_at timestamptz,
    created_at timestamptz not null default now(),
    status_updated_at timestamptz,
    unique (session_id, phone)
  );
  -- The live status stamp (amos migration 020), so the test can prove an
  -- outcome write never moves it.
  create function set_client_leads_status_updated_at() returns trigger language plpgsql as $$
  begin
    if new.status is distinct from old.status then new.status_updated_at := now(); end if;
    return new;
  end $$;
  create trigger trg_client_leads_status_ts before update on client_leads
    for each row execute function set_client_leads_status_updated_at();
  alter role service_role bypassrls;
  alter table client_leads enable row level security;
`;

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(MIGRATION);
  // Re-running must be harmless.
  await db.exec(MIGRATION);
  await db.query('insert into onboarding_sessions (id) values ($1), ($2)', [TENANT, OTHER]);
}, 60000);

afterAll(async () => { await db?.close(); });

const N = (v: unknown) => (v == null ? v : Number(v));

async function viewRows(sessionId: string): Promise<SourceRevenueRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select source, leads, won, lost, job_value_cents, collected_cents, collected_in_window_cents, collected_30d_cents
       from client_lead_revenue_by_source where session_id = $1 order by source`, [sessionId]);
  return rows.map(r => ({
    source: String(r.source), leads: Number(r.leads), won: Number(r.won), lost: Number(r.lost),
    job_value_cents: Number(r.job_value_cents), collected_cents: Number(r.collected_cents),
    collected_in_window_cents: Number(r.collected_in_window_cents), collected_30d_cents: Number(r.collected_30d_cents),
  }));
}

async function insertLead(sessionId: string, cols: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(cols);
  const { rows } = await db.query<{ id: string }>(
    `insert into client_leads (session_id${keys.map(k => `, ${k}`).join('')})
     values ($1${keys.map((_, i) => `, $${i + 2}`).join('')}) returning id`,
    [sessionId, ...keys.map(k => cols[k])],
  );
  return rows[0].id;
}

describe('recording a won job (the required test)', () => {
  it('updates the per-source return and the 15% figure, and leaves status alone', async () => {
    const metaLead = await insertLead(TENANT, { source: 'meta', phone: '+15550001001', status: 'quoted' });
    await insertLead(TENANT, { source: 'meta', phone: '+15550001002' });
    await insertLead(TENANT, { source: 'call', phone: '+15550001003' });
    await insertLead(TENANT, { source: 'web_form', phone: '+15550001004' });
    // A test phone row never reaches a rollup.
    await insertLead(TENANT, { source: 'meta', phone: '+15550001005', is_test: true });
    // Another tenant's money never shows up here.
    await insertLead(OTHER, { source: 'meta', phone: '+15550002001', status: 'serviced',
      job_outcome: 'won', job_value_cents: 999900, collected_cents: 999900 });

    const before = summarizeReturn(await viewRows(TENANT));
    expect(before.rows.find(r => r.source === 'meta')).toMatchObject({ leads: 2, won: 0, collected_cents: 0 });
    expect(before.partner.shareCents).toBe(0);
    expect(before.hasOutcomes).toBe(false);

    const { rows: [pre] } = await db.query<{ status: string; status_updated_at: string | null }>(
      'select status, status_updated_at from client_leads where id = $1', [metaLead]);

    // Exactly what PATCH /api/leads/[id]/outcome sends for a won job.
    await db.query(
      `update client_leads set job_outcome = 'won', job_value_cents = 640000, collected_cents = 320000,
         lost_reason = null, outcome_recorded_by = $3
       where id = $1 and session_id = $2`,
      [metaLead, TENANT, '00000000-0000-4000-8000-00000000c0de'],
    );

    const after = summarizeReturn(await viewRows(TENANT), { metaSpend30dCents: 80000 });
    expect(after.rows.find(r => r.source === 'meta')).toMatchObject({
      owner: 'partner', leads: 2, won: 1, lost: 0, winRate: 50,
      job_value_cents: 640000, collected_cents: 320000, collected_in_window_cents: 320000, collected_30d_cents: 320000,
    });
    expect(after.partner).toMatchObject({ collectedCents: 320000, shareCents: 48000 });
    expect(after.meta).toMatchObject({ spend30dCents: 80000, collected30dCents: 320000, returnPerDollar: 4 });

    // More cash comes in: the figure follows.
    await db.query('update client_leads set collected_cents = 640000 where id = $1', [metaLead]);
    expect(summarizeReturn(await viewRows(TENANT)).partner.shareCents).toBe(96000);

    // Status, its stamp, and the CAPI marker are untouched; the outcome stamps are set.
    const { rows: [post] } = await db.query<Record<string, unknown>>(
      'select status, status_updated_at, capi_pushed_at, outcome_at, collected_at from client_leads where id = $1', [metaLead]);
    expect(post.status).toBe(pre.status);
    expect(post.status_updated_at).toEqual(pre.status_updated_at);
    expect(post.capi_pushed_at).toBeNull();
    expect(post.outcome_at).not.toBeNull();
    expect(post.collected_at).not.toBeNull();
  });
});

describe('view parity with the TypeScript twin', () => {
  it('agrees on every source, including the 24-month and 30-day edges', async () => {
    const S = '00000000-0000-4000-8000-0000000000c3';
    await db.query('insert into onboarding_sessions (id) values ($1)', [S]);
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

    const fixtures: Partial<Lead>[] = [
      { source: 'meta', created_at: daysAgo(400), job_outcome: 'won', job_value_cents: 500000, collected_cents: 500000, collected_at: daysAgo(5) },
      { source: 'meta', created_at: daysAgo(60), job_outcome: 'won', job_value_cents: 300000, collected_cents: 100000, collected_at: daysAgo(45) },
      { source: 'meta', created_at: daysAgo(20), job_outcome: 'lost', lost_reason: 'price' },
      { source: 'meta', created_at: daysAgo(3) },
      // Exactly 24 months after first contact: outside (strict <). One second earlier: inside.
      { source: 'web_form', created_at: '2024-03-31T09:00:00.000Z', job_outcome: 'won', collected_cents: 70000, collected_at: '2026-03-31T09:00:00.000Z' },
      { source: 'web_form', created_at: '2024-03-31T09:00:00.000Z', job_outcome: 'won', collected_cents: 30000, collected_at: '2026-03-31T08:59:59.000Z' },
      // Feb 29 + 24 months clamps to Feb 28.
      { source: 'web_form', created_at: '2024-02-29T12:00:00.000Z', job_outcome: 'won', collected_cents: 11100, collected_at: '2026-02-28T12:00:00.000Z' },
      { source: 'web_form', created_at: '2024-02-29T12:00:00.000Z', job_outcome: 'won', collected_cents: 22200, collected_at: '2026-02-28T11:59:59.000Z' },
      { source: 'call', created_at: daysAgo(10), job_outcome: 'won', job_value_cents: 900000 },
      { source: 'call', created_at: daysAgo(9), job_outcome: 'won', job_value_cents: 100000, collected_cents: 0, collected_at: daysAgo(1) },
      { source: 'text', created_at: daysAgo(8), job_outcome: 'lost' },
      { source: 'typed', created_at: daysAgo(7) },
    ];

    const leads: Lead[] = [];
    let i = 0;
    for (const f of fixtures) {
      i += 1;
      const cols: Record<string, unknown> = { source: f.source, phone: `+1555000${String(3000 + i)}`, created_at: f.created_at };
      for (const k of ['job_outcome', 'job_value_cents', 'collected_cents', 'collected_at', 'lost_reason'] as const) {
        if (f[k] !== undefined) cols[k] = f[k];
      }
      const id = await insertLead(S, cols);
      leads.push({
        id, name: null, city: null, service: null, phone: null, referrer_name: null, score: null,
        status: 'open', quote_cents: null, contacted: false, after_hours: false, first_reply_seconds: null,
        ...f, source: f.source as Lead['source'], created_at: f.created_at!,
      });
    }

    const sql = await viewRows(S);
    const ts = revenueRowsFromLeads(leads, new Date()).sort((a, b) => a.source.localeCompare(b.source));
    expect(sql).toEqual(ts);
    // Pin the edges so a shared bug in both twins cannot pass.
    expect(sql.find(r => r.source === 'web_form')).toMatchObject({
      collected_cents: 133300, collected_in_window_cents: 52200,
    });
    expect(sql.find(r => r.source === 'meta')).toMatchObject({
      leads: 4, won: 2, lost: 1, collected_cents: 600000, collected_in_window_cents: 600000, collected_30d_cents: 500000,
    });
  });
});

describe('constraints and stamps', () => {
  it('rejects what the outcome route also rejects', async () => {
    const id = await insertLead(TENANT, { source: 'text', phone: '+15550004001' });
    const bad = [
      `job_outcome = 'serviced'`,
      `job_outcome = 'lost', collected_cents = 100`,
      `job_outcome = 'lost', job_value_cents = 100`,
      `job_outcome = 'won', lost_reason = 'x'`,
      `job_outcome = 'won', collected_cents = -1`,
      `collected_cents = 100`,
      `job_outcome = 'lost', lost_reason = repeat('x', 201)`,
    ];
    for (const set of bad) {
      await expect(db.query(`update client_leads set ${set} where id = $1`, [id]), set).rejects.toThrow(/violates check constraint/);
    }
  });

  it('stamps outcome_at / collected_at on change, keeps them on an unrelated write, clears them with the outcome', async () => {
    const id = await insertLead(TENANT, { source: 'text', phone: '+15550004002' });
    await db.query(`update client_leads set job_outcome = 'won', collected_cents = 1000 where id = $1`, [id]);
    const read = async () => (await db.query<{ outcome_at: Date | null; collected_at: Date | null }>(
      'select outcome_at, collected_at from client_leads where id = $1', [id])).rows[0];
    const first = await read();
    expect(first.outcome_at).not.toBeNull();
    expect(first.collected_at).not.toBeNull();

    // Backdate, then an unrelated write and a same-value write must not restamp.
    await db.query(`update client_leads set outcome_at = '2026-01-01T00:00:00Z', collected_at = '2026-01-01T00:00:00Z' where id = $1`, [id]);
    await db.query(`update client_leads set job_value_cents = 5000, job_outcome = 'won', collected_cents = 1000 where id = $1`, [id]);
    const kept = await read();
    expect(new Date(kept.outcome_at!).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(new Date(kept.collected_at!).toISOString()).toBe('2026-01-01T00:00:00.000Z');

    await db.query(`update client_leads set collected_cents = 2000 where id = $1`, [id]);
    expect(new Date((await read()).collected_at!).toISOString()).not.toBe('2026-01-01T00:00:00.000Z');

    await db.query(`update client_leads set job_outcome = null, job_value_cents = null, collected_cents = null where id = $1`, [id]);
    expect(await read()).toEqual({ outcome_at: null, collected_at: null });
  });
});

describe('session_id is immutable', () => {
  it('rejects moving a lead to another tenant', async () => {
    const id = await insertLead(TENANT, { source: 'text', phone: '+15550005001' });
    await expect(db.query('update client_leads set session_id = $2 where id = $1', [id, OTHER]))
      .rejects.toThrow(/session_id is immutable/);
    const { rows } = await db.query<{ session_id: string }>('select session_id from client_leads where id = $1', [id]);
    expect(rows[0].session_id).toBe(TENANT);
  });

  it('allows re-setting the same value and the n8n (session_id, phone) upsert', async () => {
    const id = await insertLead(TENANT, { source: 'text', phone: '+15550005002' });
    await db.query('update client_leads set session_id = $2 where id = $1', [id, TENANT]);
    await db.query(
      `insert into client_leads (session_id, phone, source, name) values ($1, $2, 'text', 'Practice Lead')
       on conflict (session_id, phone) do update set session_id = excluded.session_id, name = excluded.name`,
      [TENANT, '+15550005002'],
    );
    const { rows } = await db.query<{ name: string }>('select name from client_leads where id = $1', [id]);
    expect(rows[0].name).toBe('Practice Lead');
  });
});

describe('access to the view (real roles)', () => {
  async function asRole(role: string, sql: string) {
    await db.exec(`set role ${role}`);
    try { return await db.query(sql); } finally { await db.exec('reset role'); }
  }

  it.each(['anon', 'authenticated'])('denies %s', async (role) => {
    await expect(asRole(role, 'select * from client_lead_revenue_by_source'))
      .rejects.toThrow(/permission denied for view client_lead_revenue_by_source/);
  });

  it('lets service_role read it', async () => {
    const { rows } = await asRole('service_role', 'select session_id, source, leads from client_lead_revenue_by_source');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => N((r as { leads: unknown }).leads)! > 0)).toBe(true);
  });
});
