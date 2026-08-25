// @vitest-environment node
//
// Regression cover for lead ingest merge semantics.
//
// The bug this guards: /api/leads/ingest used a plain .insert() against the
// unique constraint client_leads_session_phone_key, so a repeat submission from
// a known phone returned 500 and the lead was discarded. The fix merges instead
// — and the merge has to be gap-fill-only, because the live row that exposed the
// bug already held a $5,300 quote that an overwrite-all upsert would have
// destroyed. That case is the first test here and must never go quiet.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const TOKEN = 'test-ingest-token';
const SESSION = '61400e73-0570-4167-88d9-d3a69650b15b';

type Row = Record<string, unknown>;

interface FakeState {
  session: { is_demo: boolean } | null;
  existing: Row[];
  /** Return an error to fail the insert; may also mutate state to simulate a race. */
  onInsert?: (rows: Row[]) => { code?: string; message: string } | null;
}

interface Calls {
  reads: number;
  inserts: Row[][];
  updates: Array<{ id: unknown; patch: Row }>;
}

let state: FakeState;
let calls: Calls;

function chain(getResult: () => unknown) {
  const obj: Record<string, unknown> = {};
  obj.select = () => obj;
  obj.eq = () => obj;
  obj.in = () => obj;
  obj.maybeSingle = () => Promise.resolve(getResult());
  obj.then = (res: unknown, rej: unknown) =>
    Promise.resolve(getResult()).then(res as never, rej as never);
  return obj;
}

function fakeClient() {
  return {
    from(table: string) {
      return {
        select() {
          if (table === 'onboarding_sessions') {
            return chain(() => ({ data: state.session, error: null }));
          }
          calls.reads += 1;
          return chain(() => ({ data: state.existing, error: null }));
        },
        insert(rows: Row[]) {
          calls.inserts.push(rows);
          const error = state.onInsert ? state.onInsert(rows) : null;
          return chain(() => ({ data: null, error }));
        },
        update(patch: Row) {
          const obj: Record<string, unknown> = {};
          obj.eq = (_col: string, value: unknown) => {
            calls.updates.push({ id: value, patch });
            return obj;
          };
          obj.then = (res: unknown, rej: unknown) =>
            Promise.resolve({ data: null, error: null }).then(res as never, rej as never);
          return obj;
        },
      };
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => fakeClient(),
}));

async function post(body: unknown, token: string | null = TOKEN) {
  const { POST } = await import('./route');
  const { NextRequest } = await import('next/server');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers['x-ingest-token'] = token;
  const req = new NextRequest('http://localhost/api/leads/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const send = (leads: Row[], extra: Row = {}) =>
  post({ session_id: SESSION, leads, ...extra });

beforeEach(() => {
  process.env.LEADS_INGEST_TOKEN = TOKEN;
  state = { session: { is_demo: false }, existing: [] };
  calls = { reads: 0, inserts: [], updates: [] };
});

describe('repeat submissions merge instead of failing', () => {
  // The live row from n8n execution 130191: quoted at $5,300 from a text-in
  // three days before Meta re-delivered the same phone.
  const quotedLead: Row = {
    id: 'row-1',
    phone: '+18014583118',
    name: null,
    city: null,
    email: null,
    address: null,
    source: 'text',
    service: 'driveway',
    quote_cents: 530000,
    status: 'open',
    created_at: '2026-08-17T23:16:39.060Z',
    status_updated_at: null,
  };

  it('fills the missing name and preserves the $5,300 quote and first-touch attribution', async () => {
    state.existing = [{ ...quotedLead }];

    const res = await send([
      {
        session_id: SESSION,
        source: 'meta',
        name: 'Kaden Brooke',
        phone: '+18014583118',
        created_at: '2026-08-20T21:45:41.000Z',
      },
    ]);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ inserted: 1, created: 0, updated: 1 });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(1);

    // The whole point: the patch touches the blank field and NOTHING else.
    expect(calls.updates[0]!.patch).toEqual({ name: 'Kaden Brooke' });
    const patched = calls.updates[0]!.patch;
    expect(patched).not.toHaveProperty('quote_cents');
    expect(patched).not.toHaveProperty('source');
    expect(patched).not.toHaveProperty('service');
    expect(patched).not.toHaveProperty('created_at');
    expect(patched).not.toHaveProperty('status');
  });

  it('never overwrites a field that already holds a value', async () => {
    state.existing = [
      { ...quotedLead, name: 'Original Name', city: 'Orem', email: 'first@example.com' },
    ];

    await send([
      {
        session_id: SESSION,
        source: 'meta',
        name: 'Different Name',
        city: 'Provo',
        email: 'second@example.com',
        phone: '+18014583118',
        created_at: '2026-08-20T21:45:41.000Z',
      },
    ]);

    // Every incoming field is already populated, so there is nothing to write.
    expect(calls.updates).toHaveLength(0);
  });

  it('counts a repeat that teaches us nothing as a successful ingest, not a drop', async () => {
    state.existing = [{ ...quotedLead, name: 'Kaden Brooke' }];

    const res = await send([
      { session_id: SESSION, source: 'meta', name: 'Kaden Brooke', phone: '+18014583118' },
    ]);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ inserted: 1, created: 0, updated: 1 });
    expect(calls.updates).toHaveLength(0);
  });

  it('inserts an unseen phone and carries email and address through', async () => {
    const res = await send([
      {
        session_id: SESSION,
        source: 'meta',
        name: 'New Lead',
        phone: '+15550001234',
        email: 'new@example.com',
        address: '123 Test St, Orem UT',
      },
    ]);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ inserted: 1, created: 1, updated: 0 });
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]![0]).toMatchObject({
      email: 'new@example.com',
      address: '123 Test St, Orem UT',
    });
  });

  it('re-reads and merges when a concurrent insert wins the race', async () => {
    // Both callers saw "no such phone"; the other one commits first.
    state.onInsert = (rows) => {
      state.existing = rows.map((r) => ({
        ...r,
        id: 'row-race',
        name: null,
        status: 'open',
        created_at: '2026-08-20T21:45:41.000Z',
        status_updated_at: null,
      }));
      state.onInsert = undefined; // only the first attempt loses
      return { code: '23505', message: 'duplicate key value violates unique constraint' };
    };

    const res = await send([
      {
        session_id: SESSION,
        source: 'meta',
        name: 'Racy Lead',
        phone: '+15550009999',
        created_at: '2026-08-20T21:45:41.000Z',
      },
    ]);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ created: 0, updated: 1 });
    expect(calls.reads).toBe(2); // initial read, then the retry's re-read
    expect(calls.updates[0]!.patch).toEqual({ name: 'Racy Lead' });
  });

  it('inserts phone-less rows without trying to merge them', async () => {
    state.existing = [{ ...quotedLead }];

    const res = await send([{ session_id: SESSION, source: 'call', name: 'Anonymous' }]);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ created: 1, updated: 0 });
    expect(calls.inserts).toHaveLength(1);
    expect(calls.updates).toHaveLength(0);
  });

  it('still refuses to write real leads into a public demo session', async () => {
    state.session = { is_demo: true };
    const res = await send([{ session_id: SESSION, phone: '+15550001234' }]);
    expect(res.status).toBe(400);
    expect(calls.inserts).toHaveLength(0);
  });
});

describe('status reopens on a genuine new inbound, never on a poller re-sync', () => {
  const servicedLead: Row = {
    id: 'row-2',
    phone: '+18015551212',
    name: 'Past Customer',
    source: 'meta',
    service: 'driveway',
    quote_cents: 410000,
    address: '55 Old Job Rd',
    status: 'serviced',
    created_at: '2026-06-01T10:00:00.000Z',
    status_updated_at: '2026-07-01T10:00:00.000Z',
  };

  it('reopens a serviced lead when the submission post-dates the last status change', async () => {
    state.existing = [{ ...servicedLead }];

    const res = await send([
      {
        session_id: SESSION,
        source: 'meta',
        name: 'Past Customer',
        phone: '+18015551212',
        created_at: '2026-08-20T11:00:00.000Z',
      },
    ]);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ updated: 1, reopened: 1 });
    expect(calls.updates[0]!.patch).toMatchObject({ status: 'open' });
    // Reopening is a lifecycle change only — qualification data is untouched.
    expect(calls.updates[0]!.patch).not.toHaveProperty('quote_cents');
    expect(calls.updates[0]!.patch).not.toHaveProperty('address');
    expect(calls.updates[0]!.patch).not.toHaveProperty('service');
    expect(calls.updates[0]!.patch).not.toHaveProperty('source');
    expect(calls.updates[0]!.patch).not.toHaveProperty('created_at');
  });

  it('does NOT reopen a booked lead when the poller re-delivers the same submission', async () => {
    // The submission arrived at 11:00, was processed at 11:15, and the
    // conversation booked the lead at 11:30. The poller now retries the very
    // same leadgen and re-sends the original 11:00 timestamp.
    state.existing = [
      {
        ...servicedLead,
        status: 'booked',
        created_at: '2026-08-20T11:00:00.000Z',
        status_updated_at: '2026-08-20T11:30:00.000Z',
      },
    ];

    const res = await send([
      {
        session_id: SESSION,
        source: 'meta',
        name: 'Past Customer',
        phone: '+18015551212',
        created_at: '2026-08-20T11:00:00.000Z',
      },
    ]);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ updated: 1, reopened: 0 });
    expect(calls.updates).toHaveLength(0);
  });

  it('does NOT reopen a lead that is already open', async () => {
    state.existing = [
      { ...servicedLead, status: 'open', status_updated_at: '2026-08-20T11:15:00.000Z' },
    ];

    const res = await send([
      {
        session_id: SESSION,
        source: 'meta',
        phone: '+18015551212',
        created_at: '2026-08-20T11:00:00.000Z',
      },
    ]);

    expect(res.json).toMatchObject({ reopened: 0 });
    expect(calls.updates).toHaveLength(0);
  });

  it('does NOT reopen from a revived lead — that is our own outbound, not the customer', async () => {
    state.existing = [{ ...servicedLead }];

    const res = await send([
      {
        session_id: SESSION,
        source: 'revived',
        phone: '+18015551212',
        created_at: '2026-08-20T11:00:00.000Z',
      },
    ]);

    expect(res.json).toMatchObject({ reopened: 0 });
    expect(calls.updates).toHaveLength(0);
  });

  it('does NOT reopen when the payload carries no submission timestamp', async () => {
    // Without a timestamp there is no way to tell a new inbound from a re-sync,
    // and guessing wrong drags booked leads back to open.
    state.existing = [{ ...servicedLead }];

    const res = await send([
      { session_id: SESSION, source: 'meta', phone: '+18015551212' },
    ]);

    expect(res.json).toMatchObject({ reopened: 0 });
    expect(calls.updates).toHaveLength(0);
  });

  it('does NOT reopen on a future-dated submission', async () => {
    // Clock skew or a bad payload. A future timestamp would beat every later
    // status change and so reopen a booked lead on every 15-minute retry —
    // caught by a live run against the real status trigger, not by mocks.
    state.existing = [{ ...servicedLead }];

    const res = await send([
      {
        session_id: SESSION,
        source: 'meta',
        phone: '+18015551212',
        created_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
    ]);

    expect(res.json).toMatchObject({ reopened: 0 });
    expect(calls.updates).toHaveLength(0);
  });

  it('reopens and gap-fills in a single update', async () => {
    state.existing = [{ ...servicedLead, city: null }];

    await send([
      {
        session_id: SESSION,
        source: 'meta',
        phone: '+18015551212',
        city: 'Draper',
        created_at: '2026-08-20T11:00:00.000Z',
      },
    ]);

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]!.patch).toEqual({ city: 'Draper', status: 'open' });
  });
});

// Cover that predates the merge work. Kept intact so this change cannot quietly
// narrow the route's contract; only the response assertions moved from toEqual
// to toMatchObject, because the body now also carries created/updated/reopened.
describe('request contract', () => {
  it('rejects a bad token before touching the database', async () => {
    const res = await post({ session_id: SESSION, leads: [] }, 'wrong-token');
    expect(res.status).toBe(401);
    expect(calls.reads).toBe(0);
    expect(calls.inserts).toHaveLength(0);
  });

  it('rejects an absent token header with 401', async () => {
    const res = await post({ session_id: SESSION, leads: [] }, null);
    expect(res.status).toBe(401);
  });

  it('rejects a payload without session_id or leads array with 400', async () => {
    expect((await post({ leads: [] })).status).toBe(400);
    expect((await post({ session_id: SESSION })).status).toBe(400);
  });

  it('inserts rows scoped to session_id and returns a count', async () => {
    const res = await send([
      { name: 'Mike R.', source: 'call', score: 92, quote_cents: 1840000, phone: '+18015550101' },
    ]);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ inserted: 1 });
    expect(calls.inserts[0]).toEqual([
      expect.objectContaining({ session_id: SESSION, name: 'Mike R.' }),
    ]);
  });

  it('strips unknown fields from lead rows', async () => {
    await send([{ name: 'A', evil: 'drop-me', phone: '+18015550102' }]);
    expect(calls.inserts[0]![0]).not.toHaveProperty('evil');
  });

  it('returns 404 for an unknown session_id', async () => {
    state.session = null;
    const res = await send([{ name: 'A', phone: '+18015550103' }]);
    expect(res.status).toBe(404);
    expect(calls.inserts).toHaveLength(0);
  });

  it('allows seeding an is_demo session when allow_demo is set', async () => {
    state.session = { is_demo: true };
    const res = await send([{ name: 'Todd R.', source: 'call', phone: '+18015550104' }], {
      allow_demo: true,
    });
    expect(res.status).toBe(200);
    expect(calls.inserts).toHaveLength(1);
  });

  it('returns 500 with the db error message when the insert fails', async () => {
    state.onInsert = () => ({ message: 'db failure' });
    const res = await send([{ name: 'Test', phone: '+18015550105' }]);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: 'db failure' });
  });
});
