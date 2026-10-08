import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, fetchMock } = vi.hoisted(() => ({
  state: {
    practice: true,
    inserts: [] as Array<{ table: string; values: unknown }>,
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
    update: (values: unknown) => {
      state.inserts.push({ table, values });
      return chain;
    },
    insert: (values: unknown) => {
      state.inserts.push({ table, values });
      return chain;
    },
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
    const response = await post();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
