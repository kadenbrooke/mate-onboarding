// @vitest-environment node
//
// Runs migration 0021 in a real Postgres (PGlite, in-process) and checks:
//   1. recording a won job and a payment (the same writes the outcome and
//      payments routes send) moves that source's return in
//      client_lead_revenue_by_source and the 15% partner figure built from it,
//      and leaves status, its stamp and the CAPI marker alone,
//   2. cash is time-correct: each payment counts in the window of its own
//      date ($5,000 earlier + $1,000 this week is $1,000 in the last 30 days;
//      cash is not cut off by the lead's age and refunds follow the one
//      clawback setting),
//   3. the view agrees with the TypeScript twin (revenueRowsFromLeads),
//   4. the ledger guards: won jobs only, tenant from the lead, no negative
//      total, no edits, no un-winning a paid job, cascade on lead delete,
//   5. client_leads.session_id cannot change after insert, while the n8n
//      "Ensure Lead SMS" upsert shape (ON CONFLICT (session_id, phone) DO
//      UPDATE) still works,
//   6. anon / authenticated are denied the ledger and the view, service_role
//      can read them,
//   7. on a database without client_leads.is_test (this repo's history alone)
//      the migration adds it and still runs.
//
// Only invented practice rows are seeded. The tables are minimal stand-ins
// with the live column names and types the migration reads.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { revenueRowsFromLeads, summarizeReturn, type LeadPayment, type RevenueLeadMessage, type SourceRevenueRow } from './revenue';
import { PARTNER_REFUND_CLAWBACK_WINDOW_MONTHS } from './partnerChannels';
import type { Lead } from './leads';

const MIGRATION = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0021_lead_job_outcome.sql'), 'utf8',
);
const PARTNER_MIGRATION = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0023_partner_channels_and_gates.sql'), 'utf8',
);
const PARTNER_RULE_MIGRATION = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0024_partner_attribution_rule.sql'), 'utf8',
);

const BASE_SCHEMA = (withIsTest: boolean) => `
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
    ${withIsTest ? 'is_test boolean not null default false,' : ''}
    capi_pushed_at timestamptz,
    created_at timestamptz not null default now(),
    status_updated_at timestamptz,
    unique (session_id, phone)
  );
  create table lead_messages (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references client_leads(id) on delete cascade,
    session_id uuid not null references onboarding_sessions(id) on delete cascade,
    direction text not null,
    author text not null,
    body text not null default ''
  );
  -- The live status stamp (amos migration 020), so the test can prove an
  -- outcome or payment write never moves it.
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
const RECORDER = '00000000-0000-4000-8000-00000000c0de';
const DAY = 86_400_000;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA(true));
  await db.exec(MIGRATION);
  // Re-running must be harmless.
  await db.exec(MIGRATION);
  await db.exec(PARTNER_MIGRATION);
  await db.exec(PARTNER_MIGRATION);
  await db.exec(PARTNER_RULE_MIGRATION);
  await db.exec(PARTNER_RULE_MIGRATION);
  await db.query('insert into onboarding_sessions (id) values ($1), ($2)', [TENANT, OTHER]);
}, 60000);

afterAll(async () => { await db?.close(); });

let phoneSeq = 0;
const phone = () => `+1555000${String(1000 + ++phoneSeq)}`;

async function newSession(): Promise<string> {
  const { rows } = await db.query<{ id: string }>('insert into onboarding_sessions (id) values (gen_random_uuid()) returning id');
  return rows[0].id;
}

async function viewRows(sessionId: string): Promise<SourceRevenueRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select source, leads, won, lost, job_value_cents, collected_cents, collected_in_window_cents, collected_30d_cents, partner_collected_in_window_cents
       from client_lead_revenue_by_source where session_id = $1 order by source`, [sessionId]);
  return rows.map(r => ({
    source: String(r.source), leads: Number(r.leads), won: Number(r.won), lost: Number(r.lost),
    job_value_cents: Number(r.job_value_cents), collected_cents: Number(r.collected_cents),
    collected_in_window_cents: Number(r.collected_in_window_cents), collected_30d_cents: Number(r.collected_30d_cents),
    partner_collected_in_window_cents: Number(r.partner_collected_in_window_cents),
  }));
}

async function insertLead(sessionId: string, cols: Record<string, unknown>): Promise<string> {
  const all = { phone: phone(), ...cols };
  const keys = Object.keys(all);
  const { rows } = await db.query<{ id: string }>(
    `insert into client_leads (session_id${keys.map(k => `, ${k}`).join('')})
     values ($1${keys.map((_, i) => `, $${i + 2}`).join('')}) returning id`,
    [sessionId, ...keys.map(k => all[k as keyof typeof all])],
  );
  return rows[0].id;
}

/** Exactly what POST /api/leads/[id]/payments inserts. */
async function addPayment(leadId: string, sessionId: string, amount: number, paidAt: string | Date) {
  await db.query(
    `insert into client_lead_payments (lead_id, session_id, amount_cents, paid_at, recorded_by)
     values ($1, $2, $3, $4, $5)`,
    [leadId, sessionId, amount, paidAt instanceof Date ? paidAt.toISOString() : paidAt, RECORDER],
  );
}

/** Exactly what PATCH /api/leads/[id]/outcome sends for a won job. */
async function markWon(leadId: string, sessionId: string, valueCents: number | null) {
  await db.query(
    `update client_leads set job_outcome = 'won', job_value_cents = $3, lost_reason = null, outcome_recorded_by = $4
     where id = $1 and session_id = $2`,
    [leadId, sessionId, valueCents, RECORDER],
  );
}

const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

describe('recording a won job and a payment (the required test)', () => {
  it('updates the per-source return and the 15% figure, and leaves status alone', async () => {
    const metaLead = await insertLead(TENANT, { source: 'meta', status: 'quoted' });
    await insertLead(TENANT, { source: 'meta' });
    await insertLead(TENANT, { source: 'call' });
    await insertLead(TENANT, { source: 'web_form' });
    // A test row never reaches a rollup.
    const testLead = await insertLead(TENANT, { source: 'meta', is_test: true });
    await markWon(testLead, TENANT, 100);
    await addPayment(testLead, TENANT, 777700, daysAgo(1));
    // Another tenant's money never shows up here.
    const otherLead = await insertLead(OTHER, { source: 'meta', status: 'serviced' });
    await markWon(otherLead, OTHER, 999900);
    await addPayment(otherLead, OTHER, 999900, daysAgo(1));

    const before = summarizeReturn(await viewRows(TENANT));
    expect(before.rows.find(r => r.source === 'meta')).toMatchObject({ leads: 2, won: 0, collected_cents: 0 });
    expect(before.partner.shareCents).toBe(0);
    expect(before.hasOutcomes).toBe(false);

    const { rows: [pre] } = await db.query<{ status: string; status_updated_at: string | null }>(
      'select status, status_updated_at from client_leads where id = $1', [metaLead]);

    await markWon(metaLead, TENANT, 640000);
    await addPayment(metaLead, TENANT, 320000, daysAgo(2));

    const after = summarizeReturn(await viewRows(TENANT), { metaSpend30dCents: 80000 });
    expect(after.rows.find(r => r.source === 'meta')).toMatchObject({
      owner: 'partner', leads: 2, won: 1, lost: 0, winRate: 50,
      job_value_cents: 640000, collected_cents: 320000, collected_in_window_cents: 320000, collected_30d_cents: 320000,
    });
    expect(after.partner).toMatchObject({ collectedCents: 320000, shareCents: 48000 });
    expect(after.meta).toMatchObject({ spend30dCents: 80000, collected30dCents: 320000, returnPerDollar: 4 });

    // A second payment comes in: the figure follows.
    await addPayment(metaLead, TENANT, 320000, daysAgo(0));
    expect(summarizeReturn(await viewRows(TENANT)).partner.shareCents).toBe(96000);

    // Status, its stamp and the CAPI marker are untouched; the outcome is stamped.
    const { rows: [post] } = await db.query<Record<string, unknown>>(
      'select status, status_updated_at, capi_pushed_at, outcome_at, outcome_recorded_by from client_leads where id = $1', [metaLead]);
    expect(post.status).toBe(pre.status);
    expect(post.status_updated_at).toEqual(pre.status_updated_at);
    expect(post.capi_pushed_at).toBeNull();
    expect(post.outcome_at).not.toBeNull();
    expect(post.outcome_recorded_by).toBe(RECORDER);

    // Each payment keeps who entered it.
    const { rows: who } = await db.query<{ recorded_by: string; session_id: string }>(
      'select recorded_by, session_id from client_lead_payments where lead_id = $1', [metaLead]);
    expect(who).toHaveLength(2);
    expect(who.every(r => r.recorded_by === RECORDER && r.session_id === TENANT)).toBe(true);
  });
});

describe('cash is counted by payment date', () => {
  it('$5,000 two months ago plus $1,000 this week is $1,000 in the last 30 days, $6,000 overall', async () => {
    const S = await newSession();
    const l = await insertLead(S, { source: 'meta', created_at: daysAgo(90).toISOString() });
    await markWon(l, S, 600000);
    await addPayment(l, S, 500000, daysAgo(60));
    await addPayment(l, S, 100000, daysAgo(3));
    const [row] = await viewRows(S);
    expect(row).toMatchObject({ collected_cents: 600000, collected_in_window_cents: 600000, collected_30d_cents: 100000 });
    expect(summarizeReturn([row], { metaSpend30dCents: 50000 }).meta).toMatchObject({ collected30dCents: 100000, returnPerDollar: 2 });
  });

  it('counts payments after first contact because there is no cash cutoff', async () => {
    const S = await newSession();
    const l = await insertLead(S, { source: 'web_form', created_at: '2024-03-31T09:00:00.000Z' });
    await markWon(l, S, 700000);
    await addPayment(l, S, 300000, '2024-05-01T12:00:00.000Z'); // deposit, inside
    await addPayment(l, S, 200000, '2026-03-31T08:59:59.000Z');
    await addPayment(l, S, 150000, '2026-03-31T09:00:00.000Z');
    await addPayment(l, S, 50000, '2026-06-01T12:00:00.000Z');
    const [row] = await viewRows(S);
    expect(row).toMatchObject({ leads: 1, won: 1, collected_cents: 700000, collected_in_window_cents: 700000 });
    expect(summarizeReturn([row]).partner).toMatchObject({ collectedCents: 700000, shareCents: 105000 });
  });

  it('a refund lands in the window it happened in, and the lead still counts once', async () => {
    const S = await newSession();
    const l = await insertLead(S, { source: 'meta', created_at: daysAgo(120).toISOString() });
    await markWon(l, S, 400000);
    await addPayment(l, S, 400000, daysAgo(100));
    await addPayment(l, S, -50000, daysAgo(5));
    const [row] = await viewRows(S);
    expect(row).toMatchObject({ leads: 1, won: 1, collected_cents: 350000, collected_30d_cents: -50000 });
    expect(summarizeReturn([row]).partner).toMatchObject({ collectedCents: 400000, shareCents: 60000 });
  });
});

describe('self-sourced partner exception', () => {
  it('locks source transitions to and from self_sourced after insert', async () => {
    const S = await newSession();
    const ordinary = await insertLead(S, { source: 'call' });
    const selfSourced = await insertLead(S, { source: 'self_sourced' });

    await expect(db.query(`update client_leads set source = 'self_sourced' where id = $1`, [ordinary]))
      .rejects.toThrow(/source.*self_sourced|self_sourced.*source/i);
    await expect(db.query(`update client_leads set source = 'call' where id = $1`, [selfSourced]))
      .rejects.toThrow(/source.*self_sourced|self_sourced.*source/i);
  });

  it('includes self-sourced cash only after a tagged counting-agent message', async () => {
    const S = await newSession();
    const agentLead = await insertLead(S, { source: 'self_sourced', created_at: daysAgo(3) });
    const ownerLead = await insertLead(S, { source: 'self_sourced', created_at: daysAgo(3) });
    const reviewLead = await insertLead(S, { source: 'self_sourced', created_at: daysAgo(3) });
    const humanLead = await insertLead(S, { source: 'self_sourced', created_at: daysAgo(3) });
    await markWon(agentLead, S, 100000);
    await markWon(ownerLead, S, 100000);
    await markWon(reviewLead, S, 100000);
    await markWon(humanLead, S, 100000);
    await addPayment(agentLead, S, 10000, daysAgo(1));
    await addPayment(ownerLead, S, 20000, daysAgo(1));
    await addPayment(reviewLead, S, 30000, daysAgo(1));
    await addPayment(humanLead, S, 40000, daysAgo(1));
    await db.query(
      `insert into lead_messages (lead_id, session_id, direction, author, source, body)
       values ($1, $2, 'outbound', 'agent', 'fr', 'practice message'),
              ($3, $2, 'outbound', 'agent', 'reputation', 'review request'),
              ($4, $2, 'outbound', 'human', 'fr', 'manual re-text')`, [agentLead, S, reviewLead, humanLead],
    );

    const { rows } = await db.query<Record<string, unknown>>(
      `select collected_in_window_cents, partner_collected_in_window_cents
         from client_lead_revenue_by_source where session_id = $1 and source = 'self_sourced'`, [S],
    );
    expect(rows[0]).toMatchObject({ collected_in_window_cents: 100000, partner_collected_in_window_cents: 10000 });
  });

  it('pins the single refund setting to off in the unapplied migration', () => {
    expect(PARTNER_RULE_MIGRATION).toContain(
      `partner_refund_clawback_window_months = ${PARTNER_REFUND_CLAWBACK_WINDOW_MONTHS}`,
    );
    expect(PARTNER_RULE_MIGRATION).not.toMatch(/24 months|24-month/);
  });
});

describe('view parity with the TypeScript twin', () => {
  it('agrees on every source with several payments per lead, across both window edges', async () => {
    const S = await newSession();
    const now = Date.now();
    const at = (d: number) => new Date(now - d * DAY).toISOString();

    type Fixture = { lead: Partial<Lead>; payments?: [number, string][]; agentMessage?: boolean };
    const fixtures: Fixture[] = [
      { lead: { source: 'meta', created_at: at(400), job_outcome: 'won', job_value_cents: 500000 },
        payments: [[200000, at(380)], [250000, at(40)], [50000, at(5)]] },
      { lead: { source: 'meta', created_at: at(60), job_outcome: 'won', job_value_cents: 300000 },
        payments: [[100000, at(45)], [-20000, at(29)]] },
      { lead: { source: 'meta', created_at: at(20), job_outcome: 'lost', lost_reason: 'price' } },
      { lead: { source: 'meta', created_at: at(3) } },
      // Payment age does not cut off the basis.
      { lead: { source: 'web_form', created_at: '2024-03-31T09:00:00.000Z', job_outcome: 'won' },
        payments: [[70000, '2026-03-31T09:00:00.000Z'], [30000, '2026-03-31T08:59:59.000Z']] },
      { lead: { source: 'web_form', created_at: '2024-02-29T12:00:00.000Z', job_outcome: 'won' },
        payments: [[11100, '2026-02-28T12:00:00.000Z'], [22200, '2026-02-28T11:59:59.000Z']] },
      { lead: { source: 'call', created_at: at(10), job_outcome: 'won', job_value_cents: 900000 } },
      { lead: { source: 'call', created_at: at(9), job_outcome: 'won', job_value_cents: 100000 },
        payments: [[100000, at(1)]] },
      { lead: { source: 'text', created_at: at(8), job_outcome: 'lost' } },
      { lead: { source: 'typed', created_at: at(7) } },
      { lead: { source: 'self_sourced', created_at: at(5), job_outcome: 'won', job_value_cents: 120000 },
        payments: [[70000, at(4)]], agentMessage: true },
      { lead: { source: 'self_sourced', created_at: at(5), job_outcome: 'won', job_value_cents: 100000 },
        payments: [[30000, at(4)]] },
    ];

    const leads: Lead[] = [];
    const payments: LeadPayment[] = [];
    const messages: RevenueLeadMessage[] = [];
    for (const f of fixtures) {
      const cols: Record<string, unknown> = { source: f.lead.source, created_at: f.lead.created_at };
      const id = await insertLead(S, cols);
      if (f.lead.job_outcome === 'won') await markWon(id, S, f.lead.job_value_cents ?? null);
      if (f.lead.job_outcome === 'lost') {
        await db.query(`update client_leads set job_outcome = 'lost', lost_reason = $2 where id = $1`, [id, f.lead.lost_reason ?? null]);
      }
      for (const [amount, paidAt] of f.payments ?? []) {
        await addPayment(id, S, amount, paidAt);
        payments.push({ lead_id: id, amount_cents: amount, paid_at: paidAt });
      }
      if (f.agentMessage) {
        await db.query(
          `insert into lead_messages (lead_id, session_id, direction, author, source, body)
           values ($1, $2, 'outbound', 'agent', 'fr', 'fake agent message')`, [id, S],
        );
        messages.push({ lead_id: id, direction: 'outbound', author: 'agent', source: 'fr' });
      }
      leads.push({
        id, name: null, city: null, service: null, phone: null, referrer_name: null, score: null,
        status: 'open', quote_cents: null, contacted: false, after_hours: false, first_reply_seconds: null,
        ...f.lead, source: f.lead.source as Lead['source'], created_at: f.lead.created_at!,
      });
    }

    const sql = await viewRows(S);
    const ts = revenueRowsFromLeads(leads, payments, new Date(), messages).sort((a, b) => a.source.localeCompare(b.source));
    expect(sql).toEqual(ts);
    // Pin the numbers so a shared bug in both twins cannot pass.
    expect(sql.find(r => r.source === 'meta')).toMatchObject({
      leads: 4, won: 2, lost: 1, job_value_cents: 800000,
      collected_cents: 580000, collected_in_window_cents: 580000, collected_30d_cents: 30000,
    });
    expect(sql.find(r => r.source === 'web_form')).toMatchObject({
      collected_cents: 133300, collected_in_window_cents: 133300,
    });
    expect(sql.find(r => r.source === 'self_sourced')).toMatchObject({
      collected_in_window_cents: 100000, partner_collected_in_window_cents: 70000,
    });
    expect(ts.find(r => r.source === 'self_sourced')).toMatchObject({
      collected_in_window_cents: 100000, partner_collected_in_window_cents: 70000,
    });
  });
});

describe('ledger guards', () => {
  it('only a won job takes payments', async () => {
    const S = await newSession();
    const open = await insertLead(S, { source: 'text' });
    await expect(addPayment(open, S, 100, daysAgo(1))).rejects.toThrow(/only be recorded on a won job/);
    await db.query(`update client_leads set job_outcome = 'lost' where id = $1`, [open]);
    await expect(addPayment(open, S, 100, daysAgo(1))).rejects.toThrow(/only be recorded on a won job/);
  });

  it('takes the tenant from the lead and refuses a mismatched one', async () => {
    const S = await newSession();
    const l = await insertLead(S, { source: 'meta' });
    await markWon(l, S, null);
    await expect(addPayment(l, OTHER, 100, daysAgo(1))).rejects.toThrow(/session does not match/);
    await db.query('insert into client_lead_payments (lead_id, amount_cents) values ($1, 100)', [l]);
    const { rows } = await db.query<{ session_id: string }>('select session_id from client_lead_payments where lead_id = $1', [l]);
    expect(rows[0].session_id).toBe(S);
  });

  it('rejects a zero or out-of-range amount, a refund past zero, and edits', async () => {
    const S = await newSession();
    const l = await insertLead(S, { source: 'meta' });
    await markWon(l, S, null);
    await expect(addPayment(l, S, 0, daysAgo(1))).rejects.toThrow(/violates check constraint/);
    await expect(addPayment(l, S, 1_000_000_001, daysAgo(1))).rejects.toThrow(/violates check constraint/);
    await addPayment(l, S, 10000, daysAgo(2));
    await expect(addPayment(l, S, -10001, daysAgo(1))).rejects.toThrow(/below zero/);
    await addPayment(l, S, -10000, daysAgo(1));
    // Removing the original payment would leave only the refund.
    await expect(db.query('delete from client_lead_payments where lead_id = $1 and amount_cents > 0', [l]))
      .rejects.toThrow(/below zero/);
    await expect(db.query('update client_lead_payments set amount_cents = 5 where lead_id = $1', [l]))
      .rejects.toThrow(/not edited/);
    // Refund first, then the payment: fine.
    await db.query('delete from client_lead_payments where lead_id = $1 and amount_cents < 0', [l]);
    await db.query('delete from client_lead_payments where lead_id = $1', [l]);
  });

  it('a paid won job cannot be un-won until its payments are removed', async () => {
    const S = await newSession();
    const l = await insertLead(S, { source: 'meta' });
    await markWon(l, S, 500000);
    await addPayment(l, S, 100000, daysAgo(1));
    await expect(db.query('update client_leads set job_outcome = null, job_value_cents = null where id = $1', [l]))
      .rejects.toThrow(/has payments recorded/);
    await expect(db.query(`update client_leads set job_outcome = 'lost', job_value_cents = null where id = $1`, [l]))
      .rejects.toThrow(/has payments recorded/);
    // Changing the sold price of the won job is fine.
    await markWon(l, S, 550000);
    await db.query('delete from client_lead_payments where lead_id = $1', [l]);
    await db.query('update client_leads set job_outcome = null, job_value_cents = null where id = $1', [l]);
    const { rows } = await db.query<{ outcome_at: unknown }>('select outcome_at from client_leads where id = $1', [l]);
    expect(rows[0].outcome_at).toBeNull();
  });

  it('deleting a lead takes its payments, refunds included', async () => {
    const S = await newSession();
    const l = await insertLead(S, { source: 'meta' });
    await markWon(l, S, null);
    await addPayment(l, S, 50000, daysAgo(3));
    await addPayment(l, S, -50000, daysAgo(1));
    await db.query('delete from client_leads where id = $1', [l]);
    const { rows } = await db.query('select 1 from client_lead_payments where lead_id = $1', [l]);
    expect(rows).toHaveLength(0);
  });
});

describe('outcome constraints and stamp', () => {
  it('rejects what the outcome route also rejects', async () => {
    const id = await insertLead(TENANT, { source: 'text' });
    const bad = [
      `job_outcome = 'serviced'`,
      `job_outcome = 'lost', job_value_cents = 100`,
      `job_value_cents = 100`,
      `job_outcome = 'won', lost_reason = 'x'`,
      `job_outcome = 'won', job_value_cents = -1`,
      `job_outcome = 'lost', lost_reason = repeat('x', 201)`,
    ];
    for (const set of bad) {
      await expect(db.query(`update client_leads set ${set} where id = $1`, [id]), set).rejects.toThrow(/violates check constraint/);
    }
  });

  it('stamps outcome_at on change, keeps it on an unrelated write, clears it with the outcome', async () => {
    const id = await insertLead(TENANT, { source: 'text' });
    await db.query(`update client_leads set job_outcome = 'won' where id = $1`, [id]);
    const read = async () => (await db.query<{ outcome_at: Date | null }>(
      'select outcome_at from client_leads where id = $1', [id])).rows[0];
    expect((await read()).outcome_at).not.toBeNull();

    await db.query(`update client_leads set outcome_at = '2026-01-01T00:00:00Z' where id = $1`, [id]);
    await db.query(`update client_leads set job_value_cents = 5000, job_outcome = 'won' where id = $1`, [id]);
    expect(new Date((await read()).outcome_at!).toISOString()).toBe('2026-01-01T00:00:00.000Z');

    await db.query(`update client_leads set job_outcome = null, job_value_cents = null where id = $1`, [id]);
    expect(await read()).toEqual({ outcome_at: null });
  });
});

describe('session_id is immutable', () => {
  it('rejects moving a lead to another tenant', async () => {
    const id = await insertLead(TENANT, { source: 'text' });
    await expect(db.query('update client_leads set session_id = $2 where id = $1', [id, OTHER]))
      .rejects.toThrow(/session_id is immutable/);
    const { rows } = await db.query<{ session_id: string }>('select session_id from client_leads where id = $1', [id]);
    expect(rows[0].session_id).toBe(TENANT);
  });

  it('allows re-setting the same value and the n8n (session_id, phone) upsert', async () => {
    const p = phone();
    const id = await insertLead(TENANT, { source: 'text', phone: p });
    await db.query('update client_leads set session_id = $2 where id = $1', [id, TENANT]);
    await db.query(
      `insert into client_leads (session_id, phone, source, name) values ($1, $2, 'text', 'Practice Lead')
       on conflict (session_id, phone) do update set session_id = excluded.session_id, name = excluded.name`,
      [TENANT, p],
    );
    const { rows } = await db.query<{ name: string }>('select name from client_leads where id = $1', [id]);
    expect(rows[0].name).toBe('Practice Lead');
  });
});

describe('access (real roles)', () => {
  async function asRole(role: string, sql: string) {
    await db.exec(`set role ${role}`);
    try { return await db.query(sql); } finally { await db.exec('reset role'); }
  }

  it.each(['anon', 'authenticated'])('denies %s the view and the ledger', async (role) => {
    await expect(asRole(role, 'select * from client_lead_revenue_by_source'))
      .rejects.toThrow(/permission denied for view client_lead_revenue_by_source/);
    await expect(asRole(role, 'select * from client_lead_payments'))
      .rejects.toThrow(/permission denied for table client_lead_payments/);
  });

  it('lets service_role read both, and not edit a payment', async () => {
    const { rows } = await asRole('service_role', 'select session_id, source, leads from client_lead_revenue_by_source');
    expect(rows.length).toBeGreaterThan(0);
    const { rows: paid } = await asRole('service_role', 'select id from client_lead_payments');
    expect(paid.length).toBeGreaterThan(0);
    await expect(asRole('service_role', 'update client_lead_payments set amount_cents = 1'))
      .rejects.toThrow(/permission denied for table client_lead_payments/);
  });

  it('lets service_role (the app) record and remove a payment through the guards', async () => {
    const S = await newSession();
    const l = await insertLead(S, { source: 'meta' });
    await markWon(l, S, null);
    await asRole('service_role', `insert into client_lead_payments (lead_id, session_id, amount_cents) values ('${l}', '${S}', 2500)`);
    await expect(asRole('service_role', `insert into client_lead_payments (lead_id, session_id, amount_cents) values ('${l}', '${S}', -2501)`))
      .rejects.toThrow(/below zero/);
    await asRole('service_role', `delete from client_lead_payments where lead_id = '${l}'`);
    const { rows } = await db.query('select 1 from client_lead_payments where lead_id = $1', [l]);
    expect(rows).toHaveLength(0);
  });
});

describe('a database without client_leads.is_test', () => {
  it('gets the column added and the view works', async () => {
    const bare = new PGlite();
    try {
      await bare.exec(BASE_SCHEMA(false));
      await bare.exec(MIGRATION);
      await bare.exec(MIGRATION);
      const { rows: col } = await bare.query<{ data_type: string; is_nullable: string; column_default: string }>(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_name = 'client_leads' and column_name = 'is_test'`);
      expect(col).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
      await bare.query('insert into onboarding_sessions (id) values ($1)', [TENANT]);
      await bare.query(`insert into client_leads (session_id, phone, source) values ($1, '+15550009999', 'meta')`, [TENANT]);
      const { rows } = await bare.query<{ leads: number }>('select leads from client_lead_revenue_by_source');
      expect(rows).toEqual([{ leads: 1 }]);
    } finally {
      await bare.close();
    }
  }, 60000);
});
