import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, seedTenants, USERS, TENANT_A, DEMO, type FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
}));
vi.mock('@/lib/supabase/service', () => {
  const m = { createServiceClient: () => h.db.client };
  // Shared mode: logins and data are the same project, so the control client is the same fake.
  return { ...m, createControlServiceClient: m.createServiceClient };
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));

import { assertAssistantAccess } from './access';

beforeEach(() => { h.db = createFakeDb(seedTenants()); h.user = null; });

describe('assertAssistantAccess', () => {
  it('404s an unknown session', async () => {
    expect((await assertAssistantAccess('nope'))?.status).toBe(404);
  });
  it('401s anonymous on a real session', async () => {
    expect((await assertAssistantAccess(TENANT_A))?.status).toBe(401);
  });
  it('403s a signed-in user who is not a member (was allowed before)', async () => {
    h.user = USERS.memberB;
    expect((await assertAssistantAccess(TENANT_A))?.status).toBe(403);
  });
  it('allows a member, an internal user, and anyone on the demo', async () => {
    h.user = USERS.memberA;
    expect(await assertAssistantAccess(TENANT_A)).toBeNull();
    h.user = USERS.internal;
    expect(await assertAssistantAccess(TENANT_A)).toBeNull();
    h.user = null;
    expect(await assertAssistantAccess(DEMO)).toBeNull();
  });
});
