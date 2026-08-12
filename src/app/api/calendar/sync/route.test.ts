import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { GoogleCalendarEvent } from '@/lib/metrics/calendarSync';

const SESSION = '61400e73-0570-4167-88d9-d3a69650b15b';
const OTHER_SESSION = 'b7573135-d4ec-43bb-bf33-a1d365739784';

// --- Supabase stub -------------------------------------------------------
// A chainable builder: every filter returns itself and awaiting it resolves the
// configured result, which is enough for the two shapes the runner uses
// (list-with-filters, and maybeSingle).
type UpsertRow = Record<string, unknown>;
type DeleteCall = { col: string; val: unknown; idCol: string; ids: string[] };

const upsertMock = vi.fn((_rows: UpsertRow[], _opts: { onConflict: string }) =>
  Promise.resolve({ error: null }),
);
const deleteMock = vi.fn((_call: DeleteCall) => Promise.resolve({ error: null }));
/** Filter calls recorded off the client_appointments SELECT, so the test can
 *  assert the prune query is session-scoped and Google-only. */
const selectFilters: [string, ...unknown[]][] = [];

let sessionRows: { id: string; google_token_ref: string | null }[] = [];
let existingRows: { id: string; google_event_id: string | null }[] = [];
/** What the single-session path reads out of the server-only token column. */
let tokenLookup: { data: { google_token_ref: string | null } | null; error: null } = {
  data: { google_token_ref: 'refresh-tok' },
  error: null,
};

type Builder = Record<string, unknown>;

function builder(result: unknown, record = false, maybeSingleResult?: unknown): Builder {
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (record) selectFilters.push([name, ...args]);
    return b;
  };
  b.select = chain('select');
  b.eq = chain('eq');
  b.not = chain('not');
  b.gte = chain('gte');
  b.lte = chain('lte');
  b.maybeSingle = () => Promise.resolve(maybeSingleResult ?? result);
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return b;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'onboarding_sessions') {
        return builder({ data: sessionRows, error: null }, false, tokenLookup);
      }
      const b = builder({ data: existingRows, error: null }, true) as Record<string, unknown>;
      b.upsert = upsertMock;
      b.delete = () => ({
        eq: (col: string, val: unknown) => ({
          in: (idCol: string, ids: string[]) => deleteMock({ col, val, idCol, ids }),
        }),
      });
      return b;
    },
  }),
}));

// --- Google stub ---------------------------------------------------------
// Network is mocked at the calendarFetch boundary; the real mapping and the
// real upsert/prune logic run.
let events: GoogleCalendarEvent[] = [];
const fetchEvents = vi.fn(
  (_token: string, _window: { timeMin: string; timeMax: string }) => Promise.resolve(events),
);

vi.mock('@/lib/metrics/calendarFetch', () => ({
  googleOAuthConfig: () => ({ clientId: 'cid', clientSecret: 'secret' }),
  calendarAccessToken: () => Promise.resolve('access-tok'),
  fetchCalendarEvents: (token: string, window: { timeMin: string; timeMax: string }) =>
    fetchEvents(token, window),
}));

import { GET, POST } from './route';

function req(opts: { bearer?: string; token?: string; sessionId?: string } = {}): NextRequest {
  const url = new URL('http://x/api/calendar/sync');
  if (opts.sessionId) url.searchParams.set('sessionId', opts.sessionId);
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.token) headers['x-ingest-token'] = opts.token;
  const request = new Request(url, { headers }) as unknown as NextRequest;
  // NextRequest exposes nextUrl; a plain Request does not.
  Object.defineProperty(request, 'nextUrl', { value: url, configurable: true });
  return request;
}

const CONFIRMED: GoogleCalendarEvent = {
  id: 'evt_live',
  status: 'confirmed',
  summary: 'Driveway sealcoat',
  start: { dateTime: '2026-08-14T17:00:00Z' },
  attendees: [{ displayName: 'Mike R.', email: 'mike@example.com' }],
};

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret';
  process.env.LEADS_INGEST_TOKEN = 'ingest-tok';
  upsertMock.mockClear();
  deleteMock.mockClear();
  fetchEvents.mockClear();
  selectFilters.length = 0;
  sessionRows = [{ id: SESSION, google_token_ref: 'refresh-tok' }];
  existingRows = [];
  events = [CONFIRMED];
  tokenLookup = { data: { google_token_ref: 'refresh-tok' }, error: null };
});

describe('GET /api/calendar/sync authorization', () => {
  it('401s with no credentials', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(fetchEvents).not.toHaveBeenCalled();
  });

  it('401s on a wrong cron secret', async () => {
    const res = await GET(req({ bearer: 'nope' }));
    expect(res.status).toBe(401);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('401s on a wrong ingest token', async () => {
    const res = await GET(req({ token: 'wrong-length-token' }));
    expect(res.status).toBe(401);
  });

  it('accepts the cron bearer secret', async () => {
    const res = await GET(req({ bearer: 'cron-secret' }));
    expect(res.status).toBe(200);
  });

  it('accepts the manual ingest token', async () => {
    const res = await POST(req({ token: 'ingest-tok' }));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/calendar/sync writes', () => {
  it('upserts on (session_id, google_event_id) so re-runs update instead of duplicating', async () => {
    const res = await GET(req({ bearer: 'cron-secret' }));
    const body = await res.json();

    expect(body).toMatchObject({ ok: true, upserted: 1 });
    expect(body.sessions[0]).toMatchObject({ session_id: SESSION, status: 'ok' });

    const [rows, options] = upsertMock.mock.calls[0];
    expect(options).toEqual({ onConflict: 'session_id,google_event_id' });
    expect(rows).toEqual([
      expect.objectContaining({
        session_id: SESSION,
        google_event_id: 'evt_live',
        customer_name: 'Mike R.',
        service: 'Driveway sealcoat',
        price_cents: null,
      }),
    ]);
  });

  it('re-running the same events produces byte-identical rows (idempotent key)', async () => {
    await GET(req({ bearer: 'cron-secret' }));
    const first = upsertMock.mock.calls[0][0];
    upsertMock.mockClear();
    await GET(req({ bearer: 'cron-secret' }));
    expect(upsertMock.mock.calls[0][0]).toEqual(first);
  });

  it('scopes the prune read to this session and to Google-sourced rows only', async () => {
    await GET(req({ bearer: 'cron-secret' }));
    expect(selectFilters).toEqual(
      expect.arrayContaining([
        ['eq', 'session_id', SESSION],
        ['not', 'google_event_id', 'is', null],
      ]),
    );
  });

  it('deletes a cancelled event and never touches a non-Google row', async () => {
    events = [
      CONFIRMED,
      { id: 'evt_cancelled', status: 'cancelled', start: { dateTime: '2026-08-15T17:00:00Z' } },
    ];
    existingRows = [
      { id: 'row-live', google_event_id: 'evt_live' },
      { id: 'row-cancelled', google_event_id: 'evt_cancelled' },
      { id: 'row-gone', google_event_id: 'evt_deleted_upstream' },
      { id: 'row-seeded-demo', google_event_id: null }, // seeded appointment
    ];

    const res = await GET(req({ bearer: 'cron-secret' }));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, removed: 2 });

    const call = deleteMock.mock.calls[0][0];
    // Cancelled + vanished-upstream go; the live row and the seeded row stay.
    expect(call.ids.sort()).toEqual(['row-cancelled', 'row-gone']);
    expect(call.ids).not.toContain('row-seeded-demo');
    expect(call.ids).not.toContain('row-live');
    // Delete is re-filtered by session_id: a stray id can never cross tenants.
    expect(call).toMatchObject({ col: 'session_id', val: SESSION, idCol: 'id' });
  });

  it('narrows to one session with ?sessionId and never pulls the others', async () => {
    sessionRows = [
      { id: SESSION, google_token_ref: 'refresh-tok' },
      { id: OTHER_SESSION, google_token_ref: 'other-tok' },
    ];
    const res = await GET(req({ bearer: 'cron-secret', sessionId: SESSION }));
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].session_id).toBe(SESSION);
    expect(upsertMock.mock.calls[0][0]).toEqual([
      expect.objectContaining({ session_id: SESSION }),
    ]);
  });

  it('skips a session with no Google connection instead of erroring', async () => {
    // The ?sessionId path reads the token column itself; an unconnected session
    // has nothing there.
    tokenLookup = { data: { google_token_ref: null }, error: null };
    const res = await GET(req({ bearer: 'cron-secret', sessionId: SESSION }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sessions[0]).toMatchObject({ status: 'skipped', detail: 'no google connection' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('reports a failed pull as a per-session error and 500s only when every session failed', async () => {
    fetchEvents.mockRejectedValueOnce(new Error('Google Calendar API error (403): insufficient scope'));
    const res = await GET(req({ bearer: 'cron-secret' }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ ok: false });
    expect(body.sessions[0]).toMatchObject({ status: 'error' });
    expect(body.sessions[0].detail).toContain('403');
  });

  it('a partial failure still reports ok when another session wrote', async () => {
    sessionRows = [
      { id: SESSION, google_token_ref: 'refresh-tok' },
      { id: OTHER_SESSION, google_token_ref: 'other-tok' },
    ];
    fetchEvents.mockRejectedValueOnce(new Error('boom'));
    const res = await GET(req({ bearer: 'cron-secret' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sessions.map((s: { status: string }) => s.status).sort()).toEqual(['error', 'ok']);
  });
});
