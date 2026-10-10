// cal.com webhook across deployments (lib/supabase/tenancy + lib/calcom/held).
// The payload carries no session id, so this is where a booking for a moved
// client could otherwise land in the wrong project, or vanish. Synthetic data:
// 555 numbers and example.* addresses only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { createFakeDb, type FakeDb } from '@/test/fakeSupabase';
import { verifyCalcomSignature } from '@/lib/calcom/verify';

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  data: null as unknown as FakeDb,
  held: [] as Record<string, unknown>[],
  texts: [] as Record<string, unknown>[],
  holdError: null as null | { code: string; message: string },
  alertError: null as null | { code: string; message: string },
}));

// Control project stub: the held-bookings table (unique on dedupe_key, like
// migration 0025) and the founder outbox.
function controlClient() {
  return {
    from(table: string) {
      if (table === 'calcom_held_bookings') {
        return {
          insert: (row: Row) => ({
            select: () => ({
              single: async () => {
                if (h.holdError) return { data: null, error: h.holdError };
                if (h.held.some((r) => r.dedupe_key === row.dedupe_key)) {
                  return { data: null, error: { code: '23505', message: 'duplicate key' } };
                }
                const id = `aaaaaaaa-0000-4000-8000-${String(h.held.length + 1).padStart(12, '0')}`;
                const stored: Row = { id, alerted_at: null, ...row };
                h.held.push(stored);
                return { data: { id, reason: stored.reason, alerted_at: null }, error: null };
              },
            }),
          }),
          select: () => ({
            eq: (_col: string, key: unknown) => ({
              maybeSingle: async () => {
                const r = h.held.find((x) => x.dedupe_key === key);
                return { data: r ? { id: r.id, reason: r.reason, alerted_at: r.alerted_at } : null, error: null };
              },
            }),
          }),
          update: (patch: Row) => ({
            eq: async (_col: string, id: unknown) => {
              const r = h.held.find((x) => x.id === id);
              if (r) Object.assign(r, patch);
              return { error: null };
            },
          }),
        };
      }
      if (table === 'outbound_texts') {
        return {
          insert: async (row: Row) => {
            if (h.alertError) return { error: h.alertError };
            h.texts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`control project has no ${table} in this test`);
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => h.data.client,
  createControlServiceClient: () => controlClient(),
}));

import { POST } from './route';
import { replayRow } from '../../../../../scripts/replay-held-calcom.mjs';

const SECRET = 'whsec_test_placeholder';
const OWN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NEW_ORIGIN = 'https://client.example.com';
const LEAD_PHONE = '+18015550101';
const LEAD_EMAIL = 'lead@example.net';

const VARS = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_DATA_URL', 'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS',
  'MATE_MOVED_SESSIONS', 'CALCOM_WEBHOOK_SECRET', 'CALCOM_BOOKING_OWNERS',
];
let saved: Record<string, string | undefined>;
const fetchMock = vi.fn();

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://control-project.supabase.co';
  process.env.CALCOM_WEBHOOK_SECRET = SECRET;
  process.env.CALCOM_BOOKING_OWNERS = `${OWN}=event:123,${OWN}=organizer:Ops@Client.example,${OTHER}=event:999`;
  h.data = createFakeDb({
    jc_sms_conversations: [{ from_number: LEAD_PHONE, status: 'engaged', calcom_booking_uid: null }],
  });
  h.held = [];
  h.texts = [];
  h.holdError = null;
  h.alertError = null;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const moved = () => { process.env.MATE_MOVED_SESSIONS = `${OWN}=${NEW_ORIGIN}`; };
const dedicated = () => {
  process.env.SUPABASE_DATA_URL = 'https://client-data-project.supabase.co';
  process.env.SUPABASE_DATA_SECRET_KEY = 'data-secret-placeholder';
  process.env.MATE_DATA_SESSION_IDS = OWN;
};

function booking(over: Row = {}) {
  return {
    triggerEvent: 'BOOKING_CREATED',
    payload: {
      uid: 'bk_test_1',
      eventTypeId: 123,
      organizer: { email: 'someone@elsewhere.example' },
      endTime: '2026-08-06T17:30:00.000Z',
      attendees: [{ email: LEAD_EMAIL, phoneNumber: LEAD_PHONE, name: 'Test Lead' }],
      ...over,
    },
  };
}

const sign = (raw: string) => createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');

function req(body: unknown, extraHeaders: Record<string, string> = {}) {
  const raw = JSON.stringify(body);
  return {
    raw,
    request: new Request('https://mate.example.com/api/webhooks/calcom', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cal-signature-256': sign(raw), ...extraHeaders },
      body: raw,
    }),
  };
}

const dataUntouched = () => {
  expect(h.data.reads).toEqual([]);
  expect(h.data.writes).toEqual([]);
};

describe('shared deployment after the client moved', () => {
  beforeEach(moved);

  it('forwards the exact signed body with only content-type and the signature header', async () => {
    const { raw, request } = req(booking(), {
      cookie: 'sb-access-token=secret-cookie',
      authorization: 'Bearer caller-token',
      'x-forwarded-for': '203.0.113.9',
      'x-real-ip': '203.0.113.9',
      'user-agent': 'cal.com',
    });
    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, forwarded: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(`${NEW_ORIGIN}/api/webhooks/calcom`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(raw);
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-cal-signature-256': sign(raw) });
    expect(init.redirect).toBe('manual');
    // The receiver can verify it with the same secret.
    expect(verifyCalcomSignature(init.body as string, (init.headers as Record<string, string>)['x-cal-signature-256'], SECRET)).toBe(true);
    dataUntouched();
    expect(h.held).toEqual([]);
    expect(h.texts).toEqual([]);
  });

  it('the forwarded request, replayed on the dedicated deployment, books the lead there', async () => {
    const { request } = req(booking());
    await POST(request);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    for (const k of VARS) if (k !== 'CALCOM_WEBHOOK_SECRET' && k !== 'CALCOM_BOOKING_OWNERS' && k !== 'NEXT_PUBLIC_SUPABASE_URL') delete process.env[k];
    dedicated();
    // Exactly what the forward sends: method, the two headers, the body.
    const replay = await POST(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ matched: true, status: 'quote_booked' });
    expect(h.data.writes).toEqual([
      expect.objectContaining({ table: 'jc_sms_conversations', op: 'update', filters: [['from_number', LEAD_PHONE]] }),
    ]);
  });

  it('attributes by organizer email too, case-insensitively', async () => {
    const { request } = req(booking({ eventTypeId: 555, organizer: { email: 'OPS@client.example' } }));
    expect((await POST(request)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['target errors', () => fetchMock.mockResolvedValue(new Response('no', { status: 500 })), 'forward answered 500'],
    ['target redirects', () => fetchMock.mockResolvedValue(new Response(null, { status: 307, headers: { location: 'https://elsewhere.example/' } })), 'forward answered 307'],
    ['network fails', () => fetchMock.mockRejectedValue(new TypeError('fetch failed')), 'forward failed: TypeError'],
  ])('holds the booking and tells the founder when the forward fails (%s)', async (_label, arrange, reason) => {
    arrange();
    const { raw, request } = req(booking());
    const res = await POST(request);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, held: true, duplicate: false });
    expect(h.held).toEqual([expect.objectContaining({
      raw_body: raw, trigger_event: 'BOOKING_CREATED', booking_uid: 'bk_test_1', reason, target_session_id: OWN,
      dedupe_key: 'uid:BOOKING_CREATED:bk_test_1',
    })]);
    expect(h.held[0].alerted_at).toEqual(expect.any(String));
    expect(h.texts).toHaveLength(1);
    expect(h.texts[0].source).toBe('mate:calcom-held:aaaaaaaa');
    dataUntouched();
  });

  it('holds an unattributable booking (no forward, no local write) and the alert names no lead', async () => {
    const { raw, request } = req(booking({ eventTypeId: 7, organizer: { email: 'nobody@example.org' } }));
    const res = await POST(request);
    expect(res.status).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.held).toEqual([expect.objectContaining({ raw_body: raw, target_session_id: null, reason: 'no configured event type or organizer matched' })]);
    const message = String(h.texts[0].message);
    for (const pii of [LEAD_PHONE, LEAD_EMAIL, 'Test Lead', '8015550101']) expect(message).not.toContain(pii);
    dataUntouched();
  });

  it('holds an ambiguous booking (event and organizer point at different tenants)', async () => {
    const { request } = req(booking({ eventTypeId: 999, organizer: { email: 'ops@client.example' } }));
    expect((await POST(request)).status).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.held).toHaveLength(1);
  });

  it('holds everything when the owner config is malformed', async () => {
    process.env.CALCOM_BOOKING_OWNERS = 'garbage';
    const { request } = req(booking());
    expect((await POST(request)).status).toBe(202);
    expect(h.held[0].reason).toBe('booking owner config is invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a retried booking that is already held and alerted is not held or alerted twice', async () => {
    const body = booking({ eventTypeId: 7 });
    expect((await POST(req(body).request)).status).toBe(202);
    const again = await POST(req(body).request);
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({ ok: true, held: true, duplicate: true });
    expect(h.held).toHaveLength(1);
    expect(h.texts).toHaveLength(1);
  });

  it('a booking with no uid is still held once per signed body', async () => {
    const body = booking({ eventTypeId: 7, uid: undefined });
    await POST(req(body).request);
    await POST(req(body).request);
    expect(h.held).toHaveLength(1);
    expect(String(h.held[0].dedupe_key)).toMatch(/^body:[0-9a-f]{64}$/);
    expect(h.texts).toHaveLength(1);
    // A different booking without a uid is its own row.
    await POST(req(booking({ eventTypeId: 7, uid: undefined, startTime: '2026-09-01T15:00:00.000Z' })).request);
    expect(h.held).toHaveLength(2);
  });

  it('if the alert does not land it answers 503 so cal.com retries, and the retry delivers it once', async () => {
    h.alertError = { code: '08006', message: 'connection failure' };
    const body = booking({ eventTypeId: 7 });
    const first = await POST(req(body).request);
    expect(first.status).toBe(503);
    expect(h.held).toHaveLength(1);
    expect(h.held[0].alerted_at).toBeNull();
    expect(h.texts).toEqual([]);

    h.alertError = null;
    const retry = await POST(req(body).request);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toEqual({ ok: true, held: true, duplicate: true });
    expect(h.held).toHaveLength(1);
    expect(h.texts).toHaveLength(1);
    expect(h.held[0].alerted_at).toEqual(expect.any(String));

    // Later retries do not alert again.
    expect((await POST(req(body).request)).status).toBe(202);
    expect(h.texts).toHaveLength(1);
  });

  it('if the hold itself fails it answers 500 and still raises the founder signal', async () => {
    h.holdError = { code: '42P01', message: 'relation does not exist' };
    const { request } = req(booking({ eventTypeId: 7 }));
    const res = await POST(request);
    expect(res.status).toBe(500);
    expect(h.texts).toHaveLength(1);
    expect(String(h.texts[0].message)).toContain('could not store it');
    dataUntouched();
  });

  it('bookings of tenants still served here run exactly as before', async () => {
    const { request } = req(booking({ eventTypeId: 999 }));
    const res = await POST(request);
    expect(await res.json()).toMatchObject({ matched: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.held).toEqual([]);
  });

  it('non-booking events are ignored as before', async () => {
    const { request } = req({ triggerEvent: 'PING', payload: {} });
    expect(await (await POST(request)).json()).toEqual({ ok: true, ignored: 'PING' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.held).toEqual([]);
  });
});

describe('dedicated deployment (fails closed)', () => {
  beforeEach(dedicated);

  it('writes a booking attributed to a session it serves', async () => {
    const res = await POST(req(booking()).request);
    expect(await res.json()).toMatchObject({ matched: true, status: 'quote_booked' });
    expect(h.held).toEqual([]);
  });

  it.each([
    ['owner config missing', () => { delete process.env.CALCOM_BOOKING_OWNERS; }, booking(), 'no configured event type or organizer matched'],
    ['owner config malformed', () => { process.env.CALCOM_BOOKING_OWNERS = 'garbage'; }, booking(), 'booking owner config is invalid'],
    ['booking unattributed', () => {}, booking({ eventTypeId: 7 }), 'no configured event type or organizer matched'],
    ['another tenant\'s booking', () => {}, booking({ eventTypeId: 999 }), 'booking belongs to a tenant this deployment does not serve'],
  ])('holds instead of writing when %s', async (_label, arrange, body, reason) => {
    arrange();
    const res = await POST(req(body).request);
    expect(res.status).toBe(202);
    dataUntouched();
    expect(h.held).toEqual([expect.objectContaining({ reason })]);
    expect(h.texts).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('replaying held bookings against the real route', () => {
  // The replay script talks to the webhook; here its "network" is this route.
  const viaRoute: typeof fetch = async (input, init) =>
    POST(new Request(input instanceof Request ? input.url : input, { method: init?.method, headers: init?.headers, body: init?.body }));

  it('resolves only when the target applied the booking, not when it held it again', async () => {
    dedicated();
    const raw = JSON.stringify(booking());

    delete process.env.CALCOM_BOOKING_OWNERS; // target still cannot attribute it
    const heldAgain = await replayRow({ raw_body: raw }, { target: NEW_ORIGIN, secret: SECRET, fetchImpl: viaRoute });
    expect(heldAgain).toEqual({ ok: false, status: 202, outcome: 'held' });
    dataUntouched();

    process.env.CALCOM_BOOKING_OWNERS = `${OWN}=event:123`;
    const applied = await replayRow({ raw_body: raw }, { target: NEW_ORIGIN, secret: SECRET, fetchImpl: viaRoute });
    expect(applied).toEqual({ ok: true, status: 200, outcome: 'applied' });
    expect(h.data.writes).toHaveLength(1);
  });

  it('a forwarded answer from the shared deployment also resolves', async () => {
    moved();
    const raw = JSON.stringify(booking());
    const result = await replayRow({ raw_body: raw }, { target: 'https://mate.example.com', secret: SECRET, fetchImpl: viaRoute });
    expect(result).toEqual({ ok: true, status: 200, outcome: 'forwarded' });
  });
});
