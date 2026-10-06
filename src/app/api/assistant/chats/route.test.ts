import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, seedTenants, USERS, TENANT_A, DEMO, type FakeDb } from '@/test/fakeSupabase';

// Real assistant gate (assertAssistantAccess -> api-gate) over an in-memory DB.
const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => h.db.client }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));

import { GET, POST } from './route';

const get = (sessionId: string) => GET({ nextUrl: new URL(`http://x/api/assistant/chats?session_id=${sessionId}`) } as never);
const post = (body: unknown) => POST(new Request('http://x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as never);

beforeEach(() => {
  h.db = createFakeDb({ ...seedTenants(), assistant_chats: [{ id: 'chat-a', session_id: TENANT_A, title: 't', updated_at: 'now' }] });
  h.user = USERS.memberA;
});

describe('GET /api/assistant/chats', () => {
  it('401s an anonymous caller on a real tenant', async () => {
    h.user = null;
    expect((await get(TENANT_A)).status).toBe(401);
  });
  it('403s a member of another tenant (IDOR)', async () => {
    h.user = USERS.memberB;
    expect((await get(TENANT_A)).status).toBe(403);
  });
  it('lists chats for a member', async () => {
    const res = await get(TENANT_A);
    expect(res.status).toBe(200);
    expect((await res.json()).chats).toHaveLength(1);
  });
  it('keeps demo sessions public', async () => {
    h.user = null;
    expect((await get(DEMO)).status).toBe(200);
  });
});

describe('POST /api/assistant/chats', () => {
  it('401s an anonymous caller', async () => {
    h.user = null;
    expect((await post({ session_id: TENANT_A })).status).toBe(401);
    expect(h.db.writes).toEqual([]);
  });
  it('403s a member of another tenant and creates nothing', async () => {
    h.user = USERS.memberB;
    expect((await post({ session_id: TENANT_A })).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });
  it('lets an internal user through to the insert', async () => {
    h.user = USERS.internal;
    await post({ session_id: TENANT_A });
    expect(h.db.writes).toEqual([expect.objectContaining({ table: 'assistant_chats', op: 'insert', values: { session_id: TENANT_A } })]);
  });
});
