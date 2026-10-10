import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, fetchMock } = vi.hoisted(() => ({
  state: {
    practice: true,
    inserts: [] as Array<{ table: string; values: unknown }>,
    optedOut: false,
    optOutReadError: false,
    optOutReadCalls: 0,
  },
  fetchMock: vi.fn(),
}));

const tenant = {
  sessionId: 'normal-session',
  contactId: 'fake-contact',
  smsFrom: '+18015550199',
  messagingProfileId: 'fake-profile',
  agentName: 'Practice Mate',
  businessName: 'Practice Paving',
  optOutLine: 'Txt STOP to opt out anytime.',
  conversationTable: 'jc_sms_conversations' as const,
};

function tableStub(table: string) {
  let selected = '';
  const chain: Record<string, unknown> = {
    select: (columns: string) => { selected = columns; return chain; },
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    update: (values: unknown) => {
      state.inserts.push({ table, values });
      return chain;
    },
    insert: (values: unknown) => {
      state.inserts.push({ table, values });
      return chain;
    },
    single: async () => ({ data: { id: 'fake-lead-id' }, error: null }),
    upsert: (values: unknown) => {
      state.inserts.push({ table, values });
      return Promise.resolve({ error: null });
    },
    maybeSingle: async () => {
      if (table === 'onboarding_sessions') {
        return {
          data: {
            id: state.practice ? 'practice-session' : 'normal-session',
            is_demo: false,
            is_practice: state.practice,
            contact_id: state.practice ? null : 'fake-contact',
            operator_phone: '+18015550199',
          },
          error: null,
        };
      }
      if (table === 'lead_snapshots' && selected.startsWith('id, status')) {
        return { data: { id: 'snapshot-1', status: 'ready', extracted: {}, storage_path: 'typed' }, error: null };
      }
      if (table === 'lead_snapshots' && selected === 'id') {
        return { data: { id: 'snapshot-1' }, error: null };
      }
      if (table === 'client_leads' && selected === 'id') {
        return { data: { id: 'fake-lead-id' }, error: null };
      }
      return { data: null, error: null };
    },
    then: (resolve: (value: unknown) => unknown) => {
      if (table === 'client_capabilities') {
        return Promise.resolve({ data: [{ capability_key: 'lead_snapshot', status: 'live' }], error: null }).then(resolve);
      }
      if (table === 'client_leads' && selected === 'id, phone, name') {
        return Promise.resolve({ data: [{ id: 'fake-lead-id', phone: '+18015550101', name: 'Fake Lead' }], error: null }).then(resolve);
      }
      if (table === 'jc_sms_conversations' && selected === 'from_number') {
        state.optOutReadCalls += 1;
        return Promise.resolve({
          data: state.optOutReadError ? null : state.optedOut ? [{ from_number: '+18015550101' }] : [],
          error: state.optOutReadError ? { message: 'latch unavailable' } : null,
        }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fake-user', email: 'practice@example.com' } } }) } }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: (table: string) => tableStub(table) }),
}));
vi.mock('@/lib/portal/api-gate', () => ({
  checkDashApiAccess: async () => ({ ok: true, access: 'member' }),
}));
vi.mock('@/lib/portal/demo', () => ({ resolveSessionId: (id: string) => id }));
vi.mock('@/lib/leads/capability', () => ({ canUseLeadSnapshot: () => true }));
vi.mock('@/lib/leads/intakeTenants', () => ({ intakeTenantFor: () => tenant }));
vi.mock('@/lib/leads/knownNumbers', () => ({
  loadKnownNumbers: async () => ({ leadKeys: new Set(), conversations: new Map(), leadsByKey: new Map() }),
  ownNumbers: () => new Set(),
}));
vi.mock('@/lib/agent/clientEvents', () => ({ emitClientEvent: vi.fn(async () => undefined) }));
vi.stubGlobal('fetch', fetchMock);

import { POST } from './route';

const requestBody = {
  rows: [{
    index: 0,
    include: true,
    source: 'lead_snapshot',
    name: 'Fake Lead',
    phone: '+18015550101',
    address: '100 Fake Street, Orem, UT 84057',
    service: 'driveway resurfacing',
    notes: 'Practice only',
  }],
  consent: true,
};

function post() {
  return POST(
    new Request('http://x/api/dash/session/snapshot/snapshot-1/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    }) as never,
    { params: Promise.resolve({ sessionId: state.practice ? 'practice-session' : 'normal-session', id: 'snapshot-1' }) },
  );
}

beforeEach(() => {
  state.practice = true;
  state.inserts.length = 0;
  state.optedOut = false;
  state.optOutReadError = false;
  state.optOutReadCalls = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ status: 'sent' }) });
  process.env.LEAD_INTAKE_WEBHOOK_URL = 'https://n8n.example.test/intake';
  process.env.LEAD_INTAKE_SECRET = 'fake-secret';
});

describe('POST /api/dash/[sessionId]/snapshot/[id]/confirm', () => {
  it('records a fake local intake without calling n8n for a practice tenant', async () => {
    const response = await post();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(json.outcomes).toEqual([expect.objectContaining({
      outcome: 'sent',
      message: expect.stringContaining('Practice fake sent'),
    })]);
    expect(state.inserts).toContainEqual(expect.objectContaining({
      table: 'lead_messages',
      values: expect.objectContaining({
        body: expect.stringContaining('[Practice fake sent to lead]'),
      }),
    }));
  });

  it('uses the intake webhook for a normal tenant', async () => {
    state.practice = false;
    const response = await POST(
      new Request('http://x/api/dash/session/snapshot/snapshot-1/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...requestBody, rows: [{ ...requestBody.rows[0], source: 'self_sourced', text: true }] }),
      }) as never,
      { params: Promise.resolve({ sessionId: 'normal-session', id: 'snapshot-1' }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][0] ? fetchMock.mock.calls[0][1].body : '{}')).toMatchObject({
      source: 'lead_snapshot', lead: { source: 'self_sourced' },
    });
  });

  it('marks an opted-out snapshot row failed without calling intake', async () => {
    state.practice = false;
    state.optedOut = true;
    const response = await POST(
      new Request('http://x/api/dash/normal-session/snapshot/snapshot-1/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
      }) as never,
      { params: Promise.resolve({ sessionId: 'normal-session', id: 'snapshot-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.outcomes).toEqual([expect.objectContaining({
      outcome: 'failed', message: expect.stringContaining('asked not to be contacted'),
    })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails a snapshot row closed when the opt-out read errors', async () => {
    state.practice = false;
    state.optOutReadError = true;
    const response = await POST(
      new Request('http://x/api/dash/normal-session/snapshot/snapshot-1/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
      }) as never,
      { params: Promise.resolve({ sessionId: 'normal-session', id: 'snapshot-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.outcomes).toEqual([expect.objectContaining({
      outcome: 'failed', message: expect.stringContaining("couldn't be checked"),
    })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a J&C number the lane normalizer rejects', async () => {
    state.practice = false;
    const response = await POST(
      new Request('http://x/api/dash/normal-session/snapshot/snapshot-1/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...requestBody, rows: [{ ...requestBody.rows[0], phone: '8010550001' }] }),
      }) as never,
      { params: Promise.resolve({ sessionId: 'normal-session', id: 'snapshot-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.outcomes).toEqual([expect.objectContaining({
      outcome: 'failed', message: expect.stringContaining('valid J&C phone number'),
    })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the opt-out set once for a multi-row snapshot batch', async () => {
    state.practice = false;
    const response = await POST(
      new Request('http://x/api/dash/normal-session/snapshot/snapshot-1/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...requestBody, rows: [
          requestBody.rows[0],
          { ...requestBody.rows[0], index: 1, phone: '+18015550102', name: 'Second Fake Lead' },
        ] }),
      }) as never,
      { params: Promise.resolve({ sessionId: 'normal-session', id: 'snapshot-1' }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.optOutReadCalls).toBe(1);
  });

  it('saves a self-sourced lead as human-owned without handing it to intake', async () => {
    state.practice = true;
    const body = { ...requestBody, rows: [{ ...requestBody.rows[0], source: 'self_sourced', text: false }] };
    const response = await POST(
      new Request('http://x/api/dash/session/snapshot/snapshot-1/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }) as never,
      { params: Promise.resolve({ sessionId: 'practice-session', id: 'snapshot-1' }) },
    );
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.inserts).toContainEqual(expect.objectContaining({
      table: 'client_leads',
      values: expect.objectContaining({ source: 'self_sourced', handler: 'human' }),
    }));
  });
});
