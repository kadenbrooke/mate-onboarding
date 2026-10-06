// @vitest-environment node
//
// Runs migration 0020 in a real Postgres (PGlite, in-process) and checks:
//   1. mate_lead_score() agrees with the TypeScript twin on every fixture,
//   2. mate_city_tier() / mate_lead_tier() agree on every listed city and on
//      the area-code tiers,
//   3. the client_lead_scores view wires the right inputs (client_leads first,
//      the J&C conversation second, the lead's own last inbound text),
//   4. a new inbound text from the lead moves it up the ranking,
//   5. anon / authenticated are denied the view and service_role can read it,
//   6. the two lookups the view does can use the migration's indexes.
//
// Only invented rows are seeded. The tables are minimal stand-ins with the
// live column names and types the migration reads.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  leadScore, cityTier, leadTier, TIER1_CITIES, TIER2_CITIES, TIER3_CITIES, TIER4_CITIES, TIER5_CITIES,
  type LeadScoreInputs,
} from './leadScore';
import { JC_SESSION_ID } from './eventSources';

const MIGRATION = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0020_lead_live_score.sql'), 'utf8',
);

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  -- Supabase hands every new table and view in public to all three roles by
  -- default. Reproduced so the migration's revoke is tested against it.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table onboarding_sessions (id uuid primary key);
  create table client_leads (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references onboarding_sessions(id),
    name text, phone text, city text, address text,
    status text not null default 'open',
    quote_cents bigint, score int,
    created_at timestamptz not null default now()
  );
  create table lead_messages (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references client_leads(id) on delete cascade,
    session_id uuid not null,
    direction text not null check (direction in ('inbound','outbound')),
    author text not null check (author in ('lead','agent','human','system')),
    body text not null,
    created_at timestamptz not null default now()
  );
  create table jc_sms_conversations (
    from_number text primary key,
    lead_name text, property_address text, city text, timeline text,
    estimated_dimensions text, estimated_quote numeric,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
`;

// Supabase's shape: the base tables are granted to every role (default
// privileges above) and protected by RLS with no policies; service_role
// bypasses RLS. So without the migration's revoke, anon could query the view
// and only RLS would stand in the way. The test proves the view itself denies.
const GRANT_BASE = `alter role service_role bypassrls;
  alter table client_leads enable row level security;
  alter table lead_messages enable row level security;
  alter table jc_sms_conversations enable row level security;`;

const OTHER_SESSION = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-10-06T18:00:00.000Z');
const ago = (days: number, from = NOW) => new Date(from.getTime() - days * 86400000).toISOString();

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(GRANT_BASE);
  await db.exec(MIGRATION);
  // Re-running must be harmless (create or replace throughout).
  await db.exec(MIGRATION);
  await db.query('insert into onboarding_sessions (id) values ($1), ($2)', [JC_SESSION_ID, OTHER_SESSION]);
}, 60000);

afterAll(async () => { await db?.close(); });

async function sqlScore(i: LeadScoreInputs, now: Date): Promise<number> {
  const { rows } = await db.query<{ s: number }>(
    'select public.mate_lead_score($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as s',
    [i.quote_cents, i.timeframe, i.city, i.name, i.phone, i.address, i.dimensions,
      i.created_at, i.last_lead_reply_at, now.toISOString()],
  );
  return rows[0].s;
}

describe('mate_lead_score parity with the TypeScript twin', () => {
  // A cross product over every branch of every component.
  const quotes = [null, 0, 1, 99999, 1250000, 2500000, 7777777];
  const timeframes = [null, '', 'ASAP', 'next week', '2 weeks', 'more than 2 weeks', 'in a month', 'next spring', 'whenever'];
  const cities = [null, '  ', 'Orem', ' SANDY ', 'Ogden'];
  // Exact thresholds included (2 / 7 / 14 days, 1 / 3 / 7 / 14 days), so a
  // < vs <= drift between the twins fails.
  const ages = [0.5, 1.99, 2, 2.01, 6.5, 7, 7.5, 13, 14, 15, 90];
  const replies = [null, 0.01, 0.99, 1, 1.01, 2.9, 3, 3.1, 6.9, 7, 7.1, 13.9, 14, 14.1, 60];
  const fieldSets: Partial<LeadScoreInputs>[] = [
    {},
    { name: 'Test Lead', phone: '+15550000010' },
    { name: 'Test Lead', phone: '+15550000010', address: '1 Test St', dimensions: '20x30' },
    { name: ' ', phone: '\t', address: '', dimensions: ' \n ' },
  ];

  const base0: LeadScoreInputs = {
    quote_cents: 400000, timeframe: 'next week', city: null, name: 'Test Lead', phone: null,
    address: null, dimensions: null, created_at: ago(5), last_lead_reply_at: null,
  };

  it('agrees on every fixture', async () => {
    const cases: LeadScoreInputs[] = [];
    let k = 0;
    for (const quote_cents of quotes) for (const timeframe of timeframes) for (const city of cities) {
      // Rotate the remaining axes instead of a full product, so every value of
      // every axis is still hit many times without 100k queries.
      const age = ages[k % ages.length];
      const reply = replies[k % replies.length];
      const fields = fieldSets[k % fieldSets.length];
      k++;
      cases.push({
        quote_cents, timeframe, city, name: null, phone: null, address: null, dimensions: null,
        ...fields,
        created_at: ago(age),
        last_lead_reply_at: reply == null ? null : ago(reply),
      });
    }
    for (const age of ages) for (const reply of replies) for (const fields of fieldSets) {
      cases.push({
        ...{ quote_cents: 500000, timeframe: 'this week', city: 'Provo', name: null, phone: null, address: null, dimensions: null },
        ...fields, created_at: ago(age), last_lead_reply_at: reply == null ? null : ago(reply),
      });
    }
    // Location axis: every tier source, including the area-code tiers that
    // only apply with neither a city nor an address.
    for (const city of [null, '', ' Park City ', 'Logan', 'Ogden', 'St. George', 'Orem']) {
      for (const address of [null, ' ', '1 Test St']) {
        for (const phone of [null, '5550100', '+18015550100', '(385) 555-0100', '+14355550100', '+12125550100']) {
          cases.push({ ...base0, city, address, phone, created_at: ago(5), last_lead_reply_at: ago(2) });
        }
      }
    }
    const mismatches: string[] = [];
    for (const c of cases) {
      const ts = leadScore(c, NOW);
      const sql = await sqlScore(c, NOW);
      if (ts !== sql) mismatches.push(`${JSON.stringify(c)} ts=${ts} sql=${sql}`);
    }
    expect(cases.length).toBeGreaterThan(1000);
    expect(mismatches).toEqual([]);
  }, 60000);

  it('mate_city_tier matches cityTier on every listed city and a few that are not', async () => {
    const cities = [
      ...TIER1_CITIES, ...TIER2_CITIES, ...TIER3_CITIES, ...TIER4_CITIES, ...TIER5_CITIES,
      'St. George', 'Orem, UT', '', null, '  Lehi  ', 'WEST VALLEY', 'PARK CITY',
    ];
    for (const c of cities) {
      const { rows } = await db.query<{ t: string | null }>('select public.mate_city_tier($1) as t', [c]);
      expect(rows[0].t, String(c)).toBe(cityTier(c));
    }
  });

  it('mate_lead_tier matches leadTier, area-code tiers included', async () => {
    for (const city of [null, ' ', 'Park City', 'St. George']) {
      for (const address of [null, '', '1 Test St']) {
        for (const phone of [null, '', '555-0100', '+18015550100', '3855550100', '+14355550100', '+19175550100']) {
          const { rows } = await db.query<{ t: string | null }>(
            'select public.mate_lead_tier($1, $2, $3) as t', [city, address, phone],
          );
          expect(rows[0].t, JSON.stringify([city, address, phone])).toBe(leadTier(city, address, phone));
        }
      }
    }
  });
});

async function insertLead(over: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(over);
  const { rows } = await db.query<{ id: string }>(
    `insert into client_leads (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(over),
  );
  return rows[0].id;
}

async function viewRow(id: string) {
  const { rows } = await db.query<{ score: number; tier: string | null; timeframe: string | null; last_lead_reply_at: string | null }>(
    'select score, tier, timeframe, last_lead_reply_at from client_lead_scores where lead_id = $1', [id],
  );
  return rows[0];
}

describe('client_lead_scores view', () => {
  it('pulls timeframe, dimensions and quote from the linked J&C conversation', async () => {
    const created = ago(4, new Date());
    await db.query(
      `insert into jc_sms_conversations (from_number, lead_name, property_address, city, timeline, estimated_dimensions, estimated_quote)
       values ('+15550000101', 'Convo Name', '9 Convo Rd', 'Lehi', 'next week', '40x60', 12000)`,
    );
    // Phone formatted differently on purpose: the link is the last 10 digits.
    const id = await insertLead({ session_id: JC_SESSION_ID, phone: '(555) 000-0101', created_at: created });
    const row = await viewRow(id);
    expect(row.timeframe).toBe('next week');
    expect(row.tier).toBe('1');
    expect(row.score).toBe(leadScore({
      quote_cents: 1200000, timeframe: 'next week', city: 'Lehi', name: 'Convo Name',
      phone: '(555) 000-0101', address: '9 Convo Rd', dimensions: '40x60',
      created_at: created, last_lead_reply_at: null,
    }, new Date()));
  });

  it('prefers client_leads values over the conversation', async () => {
    const created = ago(4, new Date());
    await db.query(
      `insert into jc_sms_conversations (from_number, city, timeline, estimated_quote)
       values ('+15550000102', 'Lehi', 'asap', 30000)`,
    );
    const id = await insertLead({
      session_id: JC_SESSION_ID, phone: '+15550000102', city: 'Sandy', quote_cents: 500000, created_at: created,
    });
    const row = await viewRow(id);
    expect(row.tier).toBe('2');
    expect(row.score).toBe(leadScore({
      quote_cents: 500000, timeframe: 'asap', city: 'Sandy', name: null, phone: '+15550000102',
      address: null, dimensions: null, created_at: created, last_lead_reply_at: null,
    }, new Date()));
  });

  it('never links another session to the J&C conversation table', async () => {
    const created = ago(4, new Date());
    await db.query(
      `insert into jc_sms_conversations (from_number, timeline, estimated_quote) values ('+15550000103', 'asap', 20000)`,
    );
    const id = await insertLead({ session_id: OTHER_SESSION, phone: '+15550000103', created_at: created });
    const row = await viewRow(id);
    expect(row.timeframe).toBeNull();
    expect(row.score).toBe(leadScore({
      quote_cents: null, timeframe: null, city: null, name: null, phone: '+15550000103',
      address: null, dimensions: null, created_at: created, last_lead_reply_at: null,
    }, new Date()));
  });

  it('scores a lead with no phone and no conversation (Meta-only) on what it has', async () => {
    const id = await insertLead({ session_id: JC_SESSION_ID, name: 'Form Lead', city: 'St. George' });
    const row = await viewRow(id);
    expect(row.score).toBeGreaterThan(0);
    expect(row.last_lead_reply_at).toBeNull();
  });
});

describe('a new inbound text from the lead moves it up the ranking (SQL)', () => {
  it('overtakes a bigger quiet lead once it texts back, and agent texts do not count', async () => {
    const created = ago(4, new Date());
    const quiet = await insertLead({
      session_id: OTHER_SESSION, name: 'Quiet Lead', phone: '+15550000201', city: 'Provo',
      quote_cents: 1500000, created_at: created,
    });
    const texter = await insertLead({
      session_id: OTHER_SESSION, name: 'Texter Lead', phone: '+15550000202', city: 'Ogden',
      quote_cents: 800000, created_at: created,
    });
    const ranking = async () => (await db.query<{ lead_id: string }>(
      'select lead_id from client_lead_scores where lead_id = any($1) order by score desc', [[quiet, texter]],
    )).rows.map(r => r.lead_id);

    expect(await ranking()).toEqual([quiet, texter]);

    // The agent texting the lead is not the lead engaging.
    await db.query(
      `insert into lead_messages (lead_id, session_id, direction, author, body) values ($1, $2, 'outbound', 'agent', 'fake agent text')`,
      [texter, OTHER_SESSION],
    );
    expect(await ranking()).toEqual([quiet, texter]);

    const before = (await viewRow(texter)).score;
    await db.query(
      `insert into lead_messages (lead_id, session_id, direction, author, body) values ($1, $2, 'inbound', 'lead', 'fake lead reply')`,
      [texter, OTHER_SESSION],
    );
    const after = await viewRow(texter);
    expect(after.last_lead_reply_at).not.toBeNull();
    expect(after.score).toBe(before + 20);
    expect(await ranking()).toEqual([texter, quiet]);
  });
});

describe('access to the view (real roles)', () => {
  async function asRole(role: string, sql: string) {
    await db.exec(`set role ${role}`);
    try { return await db.query(sql); } finally { await db.exec('reset role'); }
  }

  it.each(['anon', 'authenticated'])('denies %s', async (role) => {
    await expect(asRole(role, 'select lead_id, score from client_lead_scores'))
      .rejects.toThrow(/permission denied for view client_lead_scores/);
  });

  it('lets service_role read it', async () => {
    const { rows } = await asRole('service_role', 'select lead_id, score from client_lead_scores');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('indexes', () => {
  async function plan(sql: string) {
    await db.exec('set enable_seqscan = off');
    try {
      const { rows } = await db.query<{ 'QUERY PLAN': string }>(`explain ${sql}`);
      return rows.map(r => r['QUERY PLAN']).join('\n');
    } finally { await db.exec('reset enable_seqscan'); }
  }

  it('reply recency can use the partial inbound-lead index', async () => {
    const p = await plan(`select max(created_at) from lead_messages
      where lead_id = '00000000-0000-4000-8000-000000000001' and direction = 'inbound' and author = 'lead'`);
    expect(p).toMatch(/lead_messages_lead_reply_idx/);
  });

  it('the conversation link can use the last-10-digits expression index', async () => {
    const p = await plan(`select 1 from jc_sms_conversations c
      where right(regexp_replace(c.from_number, '[^0-9]', '', 'g'), 10) = '5550000101'`);
    expect(p).toMatch(/jc_sms_conversations_phone10_idx/);
  });
});
