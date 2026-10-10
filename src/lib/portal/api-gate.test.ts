import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, PRACTICE, seedTenants, TENANT_A, USERS, type FakeDb } from '@/test/fakeSupabase';

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

import { checkDashApiAccess } from './api-gate';

beforeEach(() => {
  h.db = createFakeDb(seedTenants());
  h.user = USERS.practice;
});

describe('practice login tenant isolation', () => {
  it('can access the practice session but not another tenant', async () => {
    expect(await checkDashApiAccess(PRACTICE)).toMatchObject({ ok: true, access: 'member' });
    expect(await checkDashApiAccess(TENANT_A)).toMatchObject({ ok: false, status: 403 });
  });
});
