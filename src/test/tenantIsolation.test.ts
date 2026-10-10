// Tenant isolation across the logins (control) project and a client's own data
// project. This code path once put a paying client's leads on the public demo,
// so every guard here is proved with two separate fake projects: anything read
// or written shows up on exactly one of them, and a refused request must leave
// both untouched.
//
// Synthetic rows only (no real names, phones or messages).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeDb, DEMO, TENANT_A, TENANT_B, type FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({
  data: null as unknown as FakeDb,
  control: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
  adFetches: 0,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => h.data.client,
  createControlServiceClient: () => h.control.client,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url }); },
  notFound: () => { throw Object.assign(new Error('NEXT_NOT_FOUND'), { url: null }); },
}));
vi.mock('@/lib/metrics/adsFetch', () => ({
  metaConfig: () => ({}),
  fetchInsights: async () => { h.adFetches += 1; return []; },
}));
vi.mock('@/lib/metrics/googleAdsFetch', () => ({
  googleAdsConfig: () => null,
  fetchGoogleAdsCampaigns: async () => { h.adFetches += 1; return {}; },
}));

import { checkDashApiAccess } from '@/lib/portal/api-gate';
import { checkDashAccess } from '@/lib/portal/dash-gate';
import { checkLeadApiAccess } from '@/lib/portal/lead-gate';
import { POST as ingest } from '@/app/api/leads/ingest/route';
import { GET as adsRefresh } from '@/app/api/ads/refresh/route';
import { syncAllCalendars, syncSessionCalendar } from '@/lib/metrics/calendarSyncRun';
import PostLogin from '@/app/postlogin/page';

// TENANT_A plays the client with its own data project. TENANT_B is any other
// tenant; STRAY is another tenant's row that has somehow reached the client's
// data project (the deployment must still refuse it).
const OWN = TENANT_A;
const STRAY = 'dddddddd-0000-4000-8000-000000000004';
const NEW_ORIGIN = 'https://client.example.com';

const USERS = {
  own: { id: 'user-own', email: 'owner@client.test' },
  other: { id: 'user-other', email: 'owner@other.test' },
  both: { id: 'user-both', email: 'both@client.test' },
  internal: { id: 'user-int', email: 'ops@mate.test' },
  waitlisted: { id: 'user-wait', email: 'wait@nowhere.test' },
};

function controlSeed() {
  return {
    portal_members: [
      { user_id: USERS.own.id, session_id: OWN, role: 'owner', created_at: '2026-01-01' },
      { user_id: USERS.other.id, session_id: TENANT_B, role: 'owner', created_at: '2026-01-01' },
      // Newest membership is the other tenant: a dedicated deployment must skip it.
      { user_id: USERS.both.id, session_id: OWN, role: 'owner', created_at: '2026-01-01' },
      { user_id: USERS.both.id, session_id: TENANT_B, role: 'owner', created_at: '2026-02-01' },
    ],
    portal_access: [{ email: USERS.internal.email, client_slug: 'mate' }],
    portal_waitlist: [{ user_id: USERS.waitlisted.id }],
  };
}

function dataSeed() {
  return {
    onboarding_sessions: [
      { id: OWN, is_demo: false, google_token_ref: 'tok-own' },
      { id: STRAY, is_demo: false, google_token_ref: 'tok-stray' },
    ],
    client_leads: [
      { id: 'lead-own', session_id: OWN },
      { id: 'lead-stray', session_id: STRAY },
    ],
  };
}

/** Shared deployment: one project holds everything (today's setup). */
function sharedSeed() {
  return {
    ...controlSeed(),
    onboarding_sessions: [
      { id: OWN, is_demo: false, google_token_ref: 'tok-own' },
      { id: TENANT_B, is_demo: false, google_token_ref: 'tok-b' },
      { id: DEMO, is_demo: true, google_token_ref: null },
    ],
    client_leads: [{ id: 'lead-own', session_id: OWN }, { id: 'lead-b', session_id: TENANT_B }],
  };
}

const VARS = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_DATA_URL', 'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS',
  'MATE_MOVED_SESSIONS', 'LEADS_INGEST_TOKEN', 'CRON_SECRET', 'META_JC_SESSION_ID',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI',
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://control-project.supabase.co';
  process.env.LEADS_INGEST_TOKEN = 'ingest-token-placeholder';
  process.env.CRON_SECRET = 'cron-secret-placeholder';
  h.user = null;
  h.adFetches = 0;
});
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function useDedicated() {
  process.env.SUPABASE_DATA_URL = 'https://client-data-project.supabase.co';
  process.env.SUPABASE_DATA_SECRET_KEY = 'data-secret-placeholder';
  process.env.MATE_DATA_SESSION_IDS = OWN;
  h.control = createFakeDb(controlSeed());
  h.data = createFakeDb(dataSeed());
}

function useShared(moved = false) {
  if (moved) process.env.MATE_MOVED_SESSIONS = `${OWN}=${NEW_ORIGIN}`;
  h.data = createFakeDb(sharedSeed());
  h.control = h.data;
}

const untouched = () => {
  expect(h.data.reads, 'data project reads').toEqual([]);
  expect(h.data.writes, 'data project writes').toEqual([]);
  expect(h.control.reads, 'control project reads').toEqual([]);
  expect(h.control.writes, 'control project writes').toEqual([]);
};

const tables = (db: FakeDb) => [...new Set(db.reads.map((r) => r.table))].sort();

const ingestReq = (body: unknown) =>
  new NextRequest('https://deploy.example.com/api/leads/ingest', {
    method: 'POST',
    headers: { 'x-ingest-token': 'ingest-token-placeholder', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const cronReq = () =>
  new NextRequest('https://deploy.example.com/api/ads/refresh', {
    headers: { authorization: 'Bearer cron-secret-placeholder' },
  });

async function postLoginTarget(): Promise<string> {
  try {
    await PostLogin();
  } catch (e) {
    return (e as { url: string }).url;
  }
  throw new Error('postlogin did not redirect');
}

describe('dedicated deployment (client data project)', () => {
  beforeEach(useDedicated);

  it('reads the session from the data project and membership from the control project', async () => {
    h.user = USERS.own;
    expect(await checkDashApiAccess(OWN)).toEqual({ ok: true, access: 'member' });
    expect(tables(h.data)).toEqual(['onboarding_sessions']);
    expect(tables(h.control)).toEqual(['portal_access', 'portal_members']);
  });

  it('the public demo can never reach the client data project, by alias or uuid', async () => {
    for (const user of [null, USERS.internal]) {
      h.user = user;
      expect(await checkDashApiAccess(DEMO)).toMatchObject({ ok: false, status: 404 });
      expect(await checkDashAccess('demo')).toBe('not-found');
      expect(await checkDashAccess(DEMO)).toBe('not-found');
    }
    const res = await ingest(ingestReq({ session_id: DEMO, allow_demo: true, leads: [{ service: 'x' }] }));
    expect(res.status).toBe(404);
    untouched();
  });

  it('never serves another tenant, even to internal staff or when its rows are present', async () => {
    h.user = USERS.internal;
    for (const id of [TENANT_B, STRAY]) {
      expect(await checkDashApiAccess(id)).toMatchObject({ ok: false, status: 404 });
      expect(await checkDashAccess(id)).toBe('not-found');
    }
    untouched();

    // A lead id is not a way around it: the lead's own session is refused.
    expect(await checkLeadApiAccess('lead-stray')).toMatchObject({ ok: false, status: 404 });
    expect(tables(h.data)).toEqual(['client_leads']);
    expect(h.control.reads).toEqual([]);
  });

  it('a served session flagged is_demo in the data project is still not public', async () => {
    h.data.tables.onboarding_sessions[0].is_demo = true;
    expect(await checkDashApiAccess(OWN)).toMatchObject({ ok: false, status: 404 });
    expect(await checkDashAccess(OWN)).toBe('not-found');
    expect(h.control.reads).toEqual([]);
  });

  it('ingest refuses other tenants and writes its own leads to the data project only', async () => {
    expect((await ingest(ingestReq({ session_id: TENANT_B, leads: [{ service: 'x' }] }))).status).toBe(404);
    expect((await ingest(ingestReq({ session_id: STRAY, leads: [{ service: 'x' }] }))).status).toBe(404);
    untouched();

    const ok = await ingest(ingestReq({ session_id: OWN, leads: [{ service: 'sealcoat' }] }));
    expect(ok.status).toBe(200);
    expect(h.data.writes).toEqual([
      expect.objectContaining({ table: 'client_leads', op: 'insert', values: [{ session_id: OWN, service: 'sealcoat' }] }),
    ]);
    expect(h.control.reads).toEqual([]);
    expect(h.control.writes).toEqual([]);
  });

  it('post-login only routes to served sessions; no demo, waitlist or claim fallback', async () => {
    h.user = USERS.both;
    expect(await postLoginTarget()).toBe(`/dash/${OWN}`);
    expect(h.control.reads[0].filters).toContainEqual(['in:session_id', [OWN]]);
    expect(h.data.reads).toEqual([]);

    h.user = USERS.other;
    expect(await postLoginTarget()).toBe('/login?error=unauthorized');
    h.user = USERS.internal;
    expect(await postLoginTarget()).toBe(`/dash/${OWN}`);
    h.user = USERS.waitlisted;
    expect(await postLoginTarget()).toBe('/login?error=unauthorized');
    expect(h.data.reads).toEqual([]);
  });

  it('the ads cron refuses a session it does not serve before fetching anything', async () => {
    process.env.META_JC_SESSION_ID = TENANT_B;
    const res = await adsRefresh(cronReq());
    expect(res.status).toBe(500);
    expect(h.adFetches).toBe(0);
    untouched();

    process.env.META_JC_SESSION_ID = OWN;
    expect((await adsRefresh(cronReq())).status).toBe(200);
    expect(h.adFetches).toBe(1);
    expect(h.control.writes).toEqual([]);
  });

  it('the calendar cron syncs only served sessions found in the data project', async () => {
    const results = await syncAllCalendars();
    expect(results.map((r) => r.session_id)).toEqual([OWN]);
    expect(tables(h.control)).toEqual([]);

    expect(await syncSessionCalendar(STRAY)).toMatchObject({ status: 'error', detail: 'session not served by this deployment' });
  });
});

describe('shared deployment with the client moved out', () => {
  beforeEach(() => useShared(true));

  it('stops serving the moved session from the shared project', async () => {
    h.user = USERS.own;
    expect(await checkDashApiAccess(OWN)).toMatchObject({ ok: false, status: 410 });
    expect(await checkDashAccess(OWN)).toBe('not-found');
    expect(await checkLeadApiAccess('lead-own')).toMatchObject({ ok: false, status: 410 });
    expect(h.data.writes).toEqual([]);
    expect(tables(h.data)).toEqual(['client_leads']);
  });

  it('forwards the moved session\'s ingest to its new deployment instead of writing here', async () => {
    const res = await ingest(ingestReq({ session_id: OWN, leads: [{ service: 'x' }] }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${NEW_ORIGIN}/api/leads/ingest`);
    untouched();

    // Everyone else is unaffected.
    expect((await ingest(ingestReq({ session_id: TENANT_B, leads: [] }))).status).toBe(200);
  });

  it('crons stand down for the moved session and keep running for the rest', async () => {
    process.env.META_JC_SESSION_ID = OWN;
    const res = await adsRefresh(cronReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: 'session served by another deployment' });
    expect(h.adFetches).toBe(0);

    const results = await syncAllCalendars();
    expect(results.map((r) => r.session_id)).toEqual([TENANT_B]);
    expect(await syncSessionCalendar(OWN)).toMatchObject({ status: 'skipped', detail: 'served by another deployment' });
  });

  it('the demo stays public on the shared deployment', async () => {
    expect(await checkDashAccess('demo')).toBe('demo');
  });
});

describe('shared deployment with nothing configured (today)', () => {
  beforeEach(() => useShared(false));

  it('behaves as before: members in, demo public, other tenants forbidden', async () => {
    h.user = USERS.own;
    expect(await checkDashApiAccess(OWN)).toEqual({ ok: true, access: 'member' });
    expect(await checkDashApiAccess(TENANT_B)).toMatchObject({ ok: false, status: 403 });
    expect(await checkDashAccess(DEMO)).toBe('demo');
    h.user = USERS.other;
    expect(await postLoginTarget()).toBe(`/dash/${TENANT_B}`);
    // No tenant lock on the membership lookup: same query as before.
    const memberRead = h.data.reads.filter((r) => r.table === 'portal_members').at(-1);
    expect(memberRead?.filters).toEqual([['user_id', USERS.other.id]]);
    h.user = USERS.waitlisted;
    expect(await postLoginTarget()).toBe(`/dash/${DEMO}`);
  });
});
