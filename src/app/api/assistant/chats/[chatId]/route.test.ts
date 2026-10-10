import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, seedTenants, USERS, TENANT_A, type FakeDb } from '@/test/fakeSupabase';

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

import { GET, DELETE } from './route';

const ctx = (chatId: string) => ({ params: Promise.resolve({ chatId }) });

beforeEach(() => {
  h.db = createFakeDb({
    ...seedTenants(),
    assistant_chats: [{ id: 'chat-a', session_id: TENANT_A }],
    assistant_messages: [{ id: 'm1', chat_id: 'chat-a', role: 'user', content: 'secret', created_at: 'now' }],
  });
  h.user = USERS.memberA;
});

describe('GET /api/assistant/chats/[chatId]', () => {
  it('401s an anonymous caller', async () => {
    h.user = null;
    expect((await GET({} as never, ctx('chat-a'))).status).toBe(401);
  });
  it('403s a member of another tenant (IDOR on chat id)', async () => {
    h.user = USERS.memberB;
    expect((await GET({} as never, ctx('chat-a'))).status).toBe(403);
  });
  it('returns messages for a member', async () => {
    const res = await GET({} as never, ctx('chat-a'));
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toHaveLength(1);
  });
});

describe('DELETE /api/assistant/chats/[chatId]', () => {
  it('401s an anonymous caller and deletes nothing', async () => {
    h.user = null;
    expect((await DELETE({} as never, ctx('chat-a'))).status).toBe(401);
    expect(h.db.writes).toEqual([]);
  });
  it('403s a member of another tenant and deletes nothing', async () => {
    h.user = USERS.memberB;
    expect((await DELETE({} as never, ctx('chat-a'))).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });
  it('deletes for a member', async () => {
    expect((await DELETE({} as never, ctx('chat-a'))).status).toBe(200);
    expect(h.db.writes).toEqual([expect.objectContaining({ table: 'assistant_chats', op: 'delete' })]);
  });
});
