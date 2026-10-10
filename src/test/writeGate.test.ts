// The dedicated deployment's write gate (lib/supabase/write-gate), route by
// route. Every route or webhook that can write to the client's data project is
// listed here. With JC_DASHBOARD_WRITES_ENABLED unset (or anything but "1")
// each one must refuse BEFORE it reads, sends or writes anything; with it set
// to "1" each one must get past the gate. Reads keep working while shut.
//
// The route manifest (lib/supabase/route-manifest.test.ts) checks that this
// table and the app's write routes stay in step.
//
// Synthetic ids, hosts and tokens only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { createFakeDb, type FakeDb } from '@/test/fakeSupabase';
import { signState, QB_STATE_COOKIE } from '@/lib/qbo/state';

const h = vi.hoisted(() => ({
  data: null as unknown as FakeDb,
  control: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
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

const OWN = '11111111-1111-4111-8111-111111111111';
const HOST = 'https://jc.example.com';
const T = {
  ingest: 'ingest-token-for-tests',
  agent: 'agent-token-for-tests',
  signal: 'signal-token-for-tests',
  cron: 'cron-token-for-tests',
  calcom: 'calcom-webhook-key-for-tests',
  qbState: 'qb-state-key-for-tests',
};
const MEMBER = { id: 'user-own', email: 'owner@client.test' };

const ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://control-project.supabase.co',
  SUPABASE_DATA_URL: 'https://client-data-project.supabase.co',
  SUPABASE_DATA_SECRET_KEY: 'data-key-for-tests',
  MATE_DATA_SESSION_IDS: OWN,
  LEADS_INGEST_TOKEN: T.ingest,
  AGENT_WEBHOOK_TOKEN: T.agent,
  SIGNAL_TOKEN: T.signal,
  CRON_SECRET: T.cron,
  CALCOM_WEBHOOK_SECRET: T.calcom,
  CALCOM_BOOKING_OWNERS: `${OWN}=event:123`,
  QBO_STATE_SECRET: T.qbState,
  META_JC_SESSION_ID: OWN,
  JC_ONBOARDING_SESSION_ID: OWN,
  GOOGLE_OAUTH_CLIENT_ID: 'google-client-for-tests',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-key-for-tests',
  GOOGLE_OAUTH_REDIRECT_URI: `${HOST}/api/connect/google/callback`,
};
const KEYS = [...Object.keys(ENV), 'JC_DASHBOARD_WRITES_ENABLED', 'MATE_MOVED_SESSIONS'];

let saved: Record<string, string | undefined>;
const fetchMock = vi.fn(async () => { throw new TypeError('network disabled in this test'); });

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, ENV);
  h.user = MEMBER;
  h.data = createFakeDb({
    onboarding_sessions: [{ id: OWN, is_demo: false, is_practice: false, operator_phone: '+18015550100', google_token_ref: 'tok' }],
    client_leads: [{ id: 'lead-1', session_id: OWN, phone: '+18015550101' }],
    assistant_chats: [{ id: 'chat-1', session_id: OWN, title: 't', updated_at: '2026-10-01' }],
    lead_snapshots: [{ id: 'snap-1', session_id: OWN, status: 'pending' }],
  });
  h.control = createFakeDb({
    portal_members: [{ user_id: MEMBER.id, session_id: OWN, role: 'owner' }],
    portal_access: [],
  });
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
type Expect = 'refused' | 'redirect' | 'held';
type Case = {
  route: string;
  method: string;
  load: () => Promise<Record<string, unknown>>;
  req: () => NextRequest;
  params?: Record<string, string>;
  off: Expect;
};

const json = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${HOST}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const get = (path: string, headers: Record<string, string> = {}) => new NextRequest(`${HOST}${path}`, { headers });

const calcomBody = JSON.stringify({
  triggerEvent: 'BOOKING_CREATED',
  payload: { uid: 'bk-gate-1', eventTypeId: 123, attendees: [{ phoneNumber: '+18015550101' }] },
});

function qbCallback(): NextRequest {
  const nonce = 'nonce-for-tests';
  const state = signState({ sessionId: OWN, nonce }, T.qbState);
  return new NextRequest(`${HOST}/api/qb/callback?code=c&realmId=r&state=${encodeURIComponent(state)}`, {
    headers: { cookie: `${QB_STATE_COOKIE}=${nonce}` },
  });
}

// Every write path a dedicated deployment can reach.
export const WRITE_CASES: Case[] = [
  { route: 'api/leads/ingest/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/leads/ingest/route'),
    req: () => json('/api/leads/ingest', 'POST', { session_id: OWN, leads: [{ service: 'sealcoat' }] }, { 'x-ingest-token': T.ingest }) },
  { route: 'api/agent/postcall/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/agent/postcall/route'),
    req: () => json(`/api/agent/postcall?k=${T.agent}&action=fire`, 'POST', { session_id: OWN, caller: '+18015550101' }) },
  { route: 'api/agent/quote-scan/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/agent/quote-scan/route'),
    req: () => json(`/api/agent/quote-scan?k=${T.agent}`, 'POST', {}) },
  { route: 'api/agent/signal/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/agent/signal/route'),
    req: () => new NextRequest(`${HOST}/api/agent/signal?k=${T.signal}&kind=operator-flip&session_id=${OWN}`, { method: 'POST' }) },
  { route: 'api/webhooks/calcom/route.ts', method: 'POST', off: 'held',
    load: () => import('@/app/api/webhooks/calcom/route'),
    req: () => new NextRequest(`${HOST}/api/webhooks/calcom`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cal-signature-256': createHmac('sha256', T.calcom).update(calcomBody, 'utf8').digest('hex') },
      body: calcomBody,
    }) },
  { route: 'api/ads/refresh/route.ts', method: 'GET', off: 'refused',
    load: () => import('@/app/api/ads/refresh/route'),
    req: () => get('/api/ads/refresh', { authorization: `Bearer ${T.cron}` }) },
  { route: 'api/ads/refresh/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/ads/refresh/route'),
    req: () => new NextRequest(`${HOST}/api/ads/refresh`, { method: 'POST', headers: { 'x-ingest-token': T.ingest } }) },
  { route: 'api/calendar/sync/route.ts', method: 'GET', off: 'refused',
    load: () => import('@/app/api/calendar/sync/route'),
    req: () => get('/api/calendar/sync', { authorization: `Bearer ${T.cron}` }) },
  { route: 'api/calendar/sync/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/calendar/sync/route'),
    req: () => new NextRequest(`${HOST}/api/calendar/sync?sessionId=${OWN}`, { method: 'POST', headers: { 'x-ingest-token': T.ingest } }) },
  { route: 'api/connect/google/route.ts', method: 'GET', off: 'redirect',
    load: () => import('@/app/api/connect/google/route'),
    req: () => get(`/api/connect/google?sessionId=${OWN}`) },
  { route: 'api/connect/google/callback/route.ts', method: 'GET', off: 'redirect',
    load: () => import('@/app/api/connect/google/callback/route'),
    req: () => get(`/api/connect/google/callback?code=c&state=${OWN}`) },
  { route: 'api/qb/connect/route.ts', method: 'GET', off: 'redirect',
    load: () => import('@/app/api/qb/connect/route'),
    req: () => get(`/api/qb/connect?sessionId=${OWN}`) },
  { route: 'api/qb/callback/route.ts', method: 'GET', off: 'redirect',
    load: () => import('@/app/api/qb/callback/route'), req: qbCallback },
  { route: 'api/dash/[sessionId]/leads/manual/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/dash/[sessionId]/leads/manual/route'), params: { sessionId: OWN },
    req: () => json(`/api/dash/${OWN}/leads/manual`, 'POST', {}) },
  { route: 'api/dash/[sessionId]/snapshot/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/dash/[sessionId]/snapshot/route'), params: { sessionId: OWN },
    req: () => json(`/api/dash/${OWN}/snapshot`, 'POST', {}) },
  { route: 'api/dash/[sessionId]/snapshot/[id]/route.ts', method: 'DELETE', off: 'refused',
    load: () => import('@/app/api/dash/[sessionId]/snapshot/[id]/route'), params: { sessionId: OWN, id: 'snap-1' },
    req: () => new NextRequest(`${HOST}/api/dash/${OWN}/snapshot/snap-1`, { method: 'DELETE' }) },
  { route: 'api/dash/[sessionId]/snapshot/[id]/confirm/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/dash/[sessionId]/snapshot/[id]/confirm/route'), params: { sessionId: OWN, id: 'snap-1' },
    req: () => json(`/api/dash/${OWN}/snapshot/snap-1/confirm`, 'POST', { consent: true, rows: [] }) },
  { route: 'api/leads/[id]/route.ts', method: 'DELETE', off: 'refused',
    load: () => import('@/app/api/leads/[id]/route'), params: { id: 'lead-1' },
    req: () => new NextRequest(`${HOST}/api/leads/lead-1?session_id=${OWN}`, { method: 'DELETE' }) },
  { route: 'api/leads/[id]/handler/route.ts', method: 'PATCH', off: 'refused',
    load: () => import('@/app/api/leads/[id]/handler/route'), params: { id: 'lead-1' },
    req: () => json('/api/leads/lead-1/handler', 'PATCH', { session_id: OWN, handler: 'human' }) },
  { route: 'api/leads/[id]/status/route.ts', method: 'PATCH', off: 'refused',
    load: () => import('@/app/api/leads/[id]/status/route'), params: { id: 'lead-1' },
    req: () => json('/api/leads/lead-1/status', 'PATCH', { session_id: OWN, status: 'quoted' }) },
  { route: 'api/leads/[id]/outcome/route.ts', method: 'PATCH', off: 'refused',
    load: () => import('@/app/api/leads/[id]/outcome/route'), params: { id: 'lead-1' },
    req: () => json('/api/leads/lead-1/outcome', 'PATCH', { session_id: OWN }) },
  { route: 'api/leads/[id]/reply/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/leads/[id]/reply/route'), params: { id: 'lead-1' },
    req: () => json('/api/leads/lead-1/reply', 'POST', { session_id: OWN, text: 'hello' }) },
  { route: 'api/leads/[id]/do-not-contact/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/leads/[id]/do-not-contact/route'), params: { id: 'lead-1' },
    req: () => json('/api/leads/lead-1/do-not-contact', 'POST', { session_id: OWN }) },
  { route: 'api/leads/[id]/payments/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/leads/[id]/payments/route'), params: { id: 'lead-1' },
    req: () => json('/api/leads/lead-1/payments', 'POST', { session_id: OWN, amount_cents: 100 }) },
  { route: 'api/leads/[id]/payments/[paymentId]/route.ts', method: 'DELETE', off: 'refused',
    load: () => import('@/app/api/leads/[id]/payments/[paymentId]/route'), params: { id: 'lead-1', paymentId: 'pay-1' },
    req: () => new NextRequest(`${HOST}/api/leads/lead-1/payments/pay-1?session_id=${OWN}`, { method: 'DELETE' }) },
  { route: 'api/assistant/chat/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/assistant/chat/route'),
    req: () => json('/api/assistant/chat', 'POST', { session_id: OWN, chat_id: 'chat-1', content: 'hi' }) },
  { route: 'api/assistant/chats/route.ts', method: 'POST', off: 'refused',
    load: () => import('@/app/api/assistant/chats/route'),
    req: () => json('/api/assistant/chats', 'POST', { session_id: OWN }) },
  { route: 'api/assistant/chats/[chatId]/route.ts', method: 'DELETE', off: 'refused',
    load: () => import('@/app/api/assistant/chats/[chatId]/route'), params: { chatId: 'chat-1' },
    req: () => new NextRequest(`${HOST}/api/assistant/chats/chat-1`, { method: 'DELETE' }) },
];

async function call(c: Case): Promise<Response | { threw: unknown }> {
  const mod = await c.load();
  const handler = mod[c.method] as Handler;
  expect(handler, `${c.route} exports ${c.method}`).toBeTypeOf('function');
  try {
    return await handler(c.req(), c.params ? { params: Promise.resolve(c.params) } : undefined);
  } catch (threw) {
    return { threw };
  }
}

const isRefusal = async (res: Response | { threw: unknown }) => {
  if (!(res instanceof Response)) return false;
  if (res.status === 503) {
    const body = await res.clone().json().catch(() => null);
    if (body?.writes === 'disabled') return true;
  }
  if (/writes_disabled/.test(res.headers.get('location') ?? '')) return true;
  return false;
};

describe('dedicated deployment, writes shut (JC_DASHBOARD_WRITES_ENABLED unset)', () => {
  it.each(WRITE_CASES.map((c) => [`${c.method} ${c.route}`, c] as const))(
    '%s refuses before reading, sending or writing anything',
    async (_label, c) => {
      const res = await call(c);
      expect(res, 'answered, not thrown').toBeInstanceOf(Response);
      const r = res as Response;

      if (c.off === 'refused') {
        expect(r.status).toBe(503);
        expect(await r.json()).toMatchObject({ error: 'Dashboard writes are not enabled on this deployment yet.', writes: 'disabled' });
      } else if (c.off === 'redirect') {
        expect([302, 307]).toContain(r.status);
        const location = new URL(r.headers.get('location') ?? '');
        expect(location.origin).toBe(HOST);
        expect(location.pathname).toBe(`/dash/${OWN}`);
        expect(location.search).toMatch(/=writes_disabled$/);
      } else {
        // cal.com: held in the control project (never lost), founder told.
        expect(r.status).toBe(202);
        expect(await r.json()).toMatchObject({ held: true });
        expect(h.control.writes.map((w) => w.table)).toEqual(['calcom_held_bookings', 'outbound_texts']);
        expect(String((h.control.writes[0].values as Record<string, unknown>).reason)).toMatch(/writes are not enabled/);
      }

      expect(h.data.reads, 'data project reads').toEqual([]);
      expect(h.data.writes, 'data project writes').toEqual([]);
      if (c.off !== 'held') expect(h.control.writes, 'control project writes').toEqual([]);
      expect(fetchMock, 'outbound calls').not.toHaveBeenCalled();
    },
  );

  it.each(['0', 'true', 'yes', ' 1', ''])('any value but "1" (%j) keeps it shut', async (value) => {
    process.env.JC_DASHBOARD_WRITES_ENABLED = value;
    const res = (await call(WRITE_CASES[0])) as Response;
    expect(res.status).toBe(503);
    expect(h.data.writes).toEqual([]);
  });

  it('reads still work: a member can load their chats', async () => {
    const { GET } = await import('@/app/api/assistant/chats/route');
    const res = await GET(get(`/api/assistant/chats?session_id=${OWN}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ chats: [expect.objectContaining({ id: 'chat-1' })] });
    expect(h.data.writes).toEqual([]);
  });

  it('token checks still come first: a bad ingest token is 401, not 503', async () => {
    const { POST } = await import('@/app/api/leads/ingest/route');
    const res = await POST(json('/api/leads/ingest', 'POST', {}, { 'x-ingest-token': 'wrong' }));
    expect(res.status).toBe(401);
  });
});

describe('dedicated deployment, writes open (JC_DASHBOARD_WRITES_ENABLED=1)', () => {
  beforeEach(() => { process.env.JC_DASHBOARD_WRITES_ENABLED = '1'; });

  it.each(WRITE_CASES.map((c) => [`${c.method} ${c.route}`, c] as const))(
    '%s gets past the gate',
    async (_label, c) => {
      expect(await isRefusal(await call(c))).toBe(false);
    },
  );

  it('a lead ingested with writes on lands in the data project', async () => {
    const { POST } = await import('@/app/api/leads/ingest/route');
    const res = await POST(json('/api/leads/ingest', 'POST', { session_id: OWN, leads: [{ service: 'sealcoat' }] }, { 'x-ingest-token': T.ingest }));
    expect(res.status).toBe(200);
    expect(h.data.writes).toEqual([
      expect.objectContaining({ table: 'client_leads', op: 'insert', values: [{ session_id: OWN, service: 'sealcoat' }] }),
    ]);
  });

  it('a booking with writes on is written to the data project, not held', async () => {
    h.data.tables.jc_sms_conversations = [{ from_number: '+18015550101', status: 'engaged', calcom_booking_uid: null }];
    const res = (await call(WRITE_CASES.find((c) => c.route === 'api/webhooks/calcom/route.ts')!)) as Response;
    expect(await res.json()).toMatchObject({ matched: true });
    expect(h.data.writes.map((w) => w.table)).toEqual(['jc_sms_conversations']);
    expect(h.control.writes).toEqual([]);
  });
});

describe('shared deployment: the variable is never read', () => {
  it('writes go through with it unset', async () => {
    for (const k of ['SUPABASE_DATA_URL', 'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS']) delete process.env[k];
    const { POST } = await import('@/app/api/leads/ingest/route');
    const res = await POST(json('/api/leads/ingest', 'POST', { session_id: OWN, leads: [{ service: 'sealcoat' }] }, { 'x-ingest-token': T.ingest }));
    expect(res.status).toBe(200);
    expect(h.data.writes).toHaveLength(1);
  });
});
