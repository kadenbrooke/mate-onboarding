import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { practice: true } }));

function tableStub(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    maybeSingle: async () => ({
      data: {
        id: state.practice ? 'practice-session' : 'normal-session',
        is_demo: false,
        is_practice: state.practice,
        contact_id: state.practice ? null : 'fake-contact',
      },
      error: null,
    }),
    insert: () => chain,
    single: async () => ({ data: { id: 'snapshot-1' }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 0, data: [], error: null }).then(resolve),
  };
  void table;
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fake-user' } } }) } }),
}));
vi.mock('@/lib/supabase/service', () => {
  const m = {
  createServiceClient: () => ({ from: (table: string) => tableStub(table) }),
};
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/portal/api-gate', () => ({ checkDashApiAccess: async () => ({ ok: true, access: 'member' }) }));
vi.mock('@/lib/portal/demo', () => ({ resolveSessionId: (id: string) => id }));
vi.mock('@/lib/leads/capability', () => ({ canUseLeadSnapshot: () => true }));

import { POST } from './route';

function post() {
  return POST(new Request('http://mate.test/api/dash/practice-session/leads/manual') as never, {
    params: Promise.resolve({ sessionId: state.practice ? 'practice-session' : 'normal-session' }),
  });
}

beforeEach(() => { state.practice = true; });

describe('POST /api/dash/[sessionId]/leads/manual', () => {
  it('creates a local typed-lead snapshot for a practice tenant', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot_id: 'snapshot-1' });
  });

  it('keeps the normal capability gate for a normal tenant', async () => {
    state.practice = false;
    const response = await post();

    expect(response.status).toBe(200);
  });
});
