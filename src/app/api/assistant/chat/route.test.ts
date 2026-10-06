import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, seedTenants, USERS, TENANT_A, TENANT_B, DEMO, type FakeDb } from '@/test/fakeSupabase';

// The real access gate (assertAssistantAccess -> api-gate -> dash-access) and
// the route's chat-ownership guard run against an in-memory DB. The fake
// honours every eq() filter, so a gate that looked up the wrong user or the
// wrong session would get the wrong answer here and fail these tests.
const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: null as { id: string; email: string } | null,
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => h.db.client }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));

// The LLM is never really called. Returning ok:false makes an allowed request
// end at 502 right after the gate, which proves it got past authorization.
vi.mock('@/lib/demo/portkey', () => ({
  portkeyChatStream: vi.fn(() =>
    Promise.resolve({ ok: false, body: null } as { ok: boolean; body: ReadableStream | null })
  ),
}));

import { portkeyChatStream } from '@/lib/demo/portkey';
import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://x/api/assistant/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const send = (session_id: string, chat_id: string) =>
  POST(req({ session_id, chat_id, content: 'hi' }) as never);

const writesTo = (table: string) => h.db.writes.filter(w => w.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  h.db = createFakeDb({
    ...seedTenants(),
    assistant_chats: [
      { id: 'chat-a', session_id: TENANT_A },
      { id: 'chat-b', session_id: TENANT_B },
      { id: 'chat-demo', session_id: DEMO },
    ],
    assistant_messages: [],
  });
  h.user = null;
});

describe('POST /api/assistant/chat', () => {
  it('returns 400 for unparseable body', async () => {
    const res = await POST(
      new Request('http://x/api/assistant/chat', { method: 'POST', body: 'not-json' }) as never
    );
    expect(res.status).toBe(400);
    expect(h.db.writes).toEqual([]);
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(req({}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('session_id, chat_id, content required');
    expect(h.db.writes).toEqual([]);
  });

  it('rejects a real session with no signed-in user → 401', async () => {
    const res = await send(TENANT_A, 'chat-a');
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Sign in required.');
    // Never reached the ownership guard or any write.
    expect(h.db.reads.some(r => r.table === 'assistant_chats')).toBe(false);
    expect(h.db.writes).toEqual([]);
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('rejects a member of ANOTHER tenant → 403 (IDOR)', async () => {
    h.user = USERS.memberB;
    const res = await send(TENANT_A, 'chat-a');
    expect(res.status).toBe(403);
    expect(h.db.writes).toEqual([]);
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('a member of tenant A gets 403 on tenant B, so membership is per session', async () => {
    h.user = USERS.memberA;
    expect((await send(TENANT_B, 'chat-b')).status).toBe(403);
    expect(h.db.writes).toEqual([]);
  });

  it('checks the signed-in user and the requested session, not some other row', async () => {
    h.user = USERS.memberA;
    await send(TENANT_A, 'chat-a');
    expect(h.db.reads).toContainEqual({
      table: 'portal_members', columns: 'role',
      filters: [['user_id', USERS.memberA.id], ['session_id', TENANT_A]],
    });
    expect(h.db.reads).toContainEqual({
      table: 'portal_access', columns: 'client_slug',
      filters: [['email', USERS.memberA.email], ['client_slug', 'mate']],
    });
  });

  it('a user whose id matches no membership and whose email is not internal → 403', async () => {
    h.user = { id: 'stranger', email: 'stranger@client-a.test' };
    expect((await send(TENANT_A, 'chat-a')).status).toBe(403);
  });

  it('lets a member of the session through the gate', async () => {
    h.user = USERS.memberA;
    const res = await send(TENANT_A, 'chat-a');
    expect(portkeyChatStream).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(502);
    expect(writesTo('assistant_messages')).toEqual([
      expect.objectContaining({ op: 'insert', values: { chat_id: 'chat-a', role: 'user', content: 'hi' } }),
    ]);
  });

  it('lets an internal user through the gate', async () => {
    h.user = USERS.internal;
    await send(TENANT_B, 'chat-b');
    expect(portkeyChatStream).toHaveBeenCalledTimes(1);
  });

  it('a member cannot pair their own session with another tenant chat_id → 404', async () => {
    h.user = USERS.memberA;
    const res = await send(TENANT_A, 'chat-b');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('chat not found');
    expect(h.db.writes).toEqual([]);
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('the public demo session cannot reach another tenant chat_id → 404', async () => {
    const res = await send(DEMO, 'chat-a');
    expect(res.status).toBe(404);
    expect(h.db.writes).toEqual([]);
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('returns 404 when the chat_id does not exist', async () => {
    const res = await send(DEMO, 'ghost-chat');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('chat not found');
    expect(h.db.writes).toEqual([]);
  });
});
