import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Service-client mock -----------------------------------------------------
// The route reaches the service client for two things in these tests:
//  1. access gate (assertAssistantAccess) reads onboarding_sessions.is_demo
//  2. ownership guard reads assistant_chats.session_id for the given chat_id
// All 5 cases return BEFORE any assistant_messages insert / portkey call, so we
// only need those two selects to be configurable. Writes are recorded so tests
// can assert they never happened.

// onboarding_sessions.select().eq().maybeSingle() → is_demo
const sessionMaybeSingle = vi.fn(() =>
  Promise.resolve({ data: { is_demo: false } as { is_demo: boolean } | null, error: null })
);
const sessionEq = vi.fn(() => ({ maybeSingle: sessionMaybeSingle }));
const sessionSelect = vi.fn(() => ({ eq: sessionEq }));

// assistant_chats.select('session_id').eq('id', chat_id).maybeSingle() → { session_id }
const ownerMaybeSingle = vi.fn(() =>
  Promise.resolve({ data: { session_id: 'sess-1' } as { session_id: string } | null, error: null })
);
const ownerEq = vi.fn(() => ({ maybeSingle: ownerMaybeSingle }));
// assistant_chats is also written to (update) in the happy path — none of these
// tests reach it, but we expose an update spy to assert it is NOT called.
const chatsUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
const chatsUpdate = vi.fn(() => ({ eq: chatsUpdateEq }));
const chatsSelect = vi.fn(() => ({ eq: ownerEq }));

// portal_members / portal_access .select().eq().eq().maybeSingle() → membership.
// Default: no membership and not internal.
const memberMaybeSingle = vi.fn(() => Promise.resolve({ data: null as { role: string } | null, error: null }));
const internalMaybeSingle = vi.fn(() => Promise.resolve({ data: null as { client_slug: string } | null, error: null }));
const membersSelect = vi.fn(() => ({ eq: () => ({ eq: () => ({ maybeSingle: memberMaybeSingle }) }) }));
const accessSelect = vi.fn(() => ({ eq: () => ({ eq: () => ({ maybeSingle: internalMaybeSingle }) }) }));

// assistant_messages.insert(...) — must NEVER be called in these pre-write cases.
const messagesInsert = vi.fn(() => Promise.resolve({ error: null }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      switch (table) {
        case 'onboarding_sessions':
          return { select: sessionSelect };
        case 'assistant_chats':
          return { select: chatsSelect, update: chatsUpdate };
        case 'assistant_messages':
          return { insert: messagesInsert };
        case 'portal_members':
          return { select: membersSelect };
        case 'portal_access':
          return { select: accessSelect };
        default:
          return {};
      }
    },
  }),
}));

// --- SSR auth-client mock ----------------------------------------------------
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: null } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

// --- Portkey mock ------------------------------------------------------------
// Must NEVER be called in cases 3-5 (all reject before the LLM call).
// The factory is hoisted above module-scope consts, so create the spy inside it
// and grab a handle afterward via the mocked module import.
vi.mock('@/lib/demo/portkey', () => ({
  portkeyChatStream: vi.fn(() =>
    Promise.resolve({ ok: true, body: null } as { ok: boolean; body: ReadableStream | null })
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

describe('POST /api/assistant/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for unparseable body', async () => {
    const res = await POST(
      new Request('http://x/api/assistant/chat', { method: 'POST', body: 'not-json' }) as never
    );
    expect(res.status).toBe(400);
    expect(messagesInsert).not.toHaveBeenCalled();
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(req({}) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('session_id, chat_id, content required');
    expect(messagesInsert).not.toHaveBeenCalled();
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('rejects a real (non-demo) session with no signed-in user → 401', async () => {
    sessionMaybeSingle.mockResolvedValueOnce({ data: { is_demo: false }, error: null });
    getUserMock.mockResolvedValueOnce({ data: { user: null } } as never);

    const res = await POST(
      req({ session_id: 'real-sess', chat_id: 'chat-1', content: 'hi' }) as never
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Sign in required.');
    // Never got past the access gate to the ownership guard or any write.
    expect(ownerMaybeSingle).not.toHaveBeenCalled();
    expect(messagesInsert).not.toHaveBeenCalled();
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant chat_id → 404 (tenant isolation guard)', async () => {
    // Demo session so the access gate passes without auth.
    sessionMaybeSingle.mockResolvedValueOnce({ data: { is_demo: true }, error: null });
    // The chat belongs to a DIFFERENT session than the one in the request body.
    ownerMaybeSingle.mockResolvedValueOnce({ data: { session_id: 'OTHER-session' }, error: null });

    const res = await POST(
      req({ session_id: 'attacker-demo-session', chat_id: 'victim-chat', content: 'leak it' }) as never
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('chat not found');
    // The security-critical assertions: no write, no LLM call.
    expect(messagesInsert).not.toHaveBeenCalled();
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('returns 404 when the chat_id does not exist', async () => {
    sessionMaybeSingle.mockResolvedValueOnce({ data: { is_demo: true }, error: null });
    ownerMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(
      req({ session_id: 'demo-sess', chat_id: 'ghost-chat', content: 'hi' }) as never
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('chat not found');
    expect(messagesInsert).not.toHaveBeenCalled();
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('rejects a signed-in user who is not a member of the session → 403 (IDOR)', async () => {
    sessionMaybeSingle.mockResolvedValueOnce({ data: { is_demo: false }, error: null });
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'other-tenant-user', email: 'x@other.test' } } } as never);

    const res = await POST(
      req({ session_id: 'real-sess', chat_id: 'chat-1', content: 'hi' }) as never
    );
    expect(res.status).toBe(403);
    expect(ownerMaybeSingle).not.toHaveBeenCalled();
    expect(messagesInsert).not.toHaveBeenCalled();
    expect(portkeyChatStream).not.toHaveBeenCalled();
  });

  it('lets a member of the session past the gate (reaches the ownership guard)', async () => {
    sessionMaybeSingle.mockResolvedValueOnce({ data: { is_demo: false }, error: null });
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'member', email: 'm@tenant.test' } } } as never);
    memberMaybeSingle.mockResolvedValueOnce({ data: { role: 'owner' }, error: null });
    ownerMaybeSingle.mockResolvedValueOnce({ data: { session_id: 'someone-else' }, error: null });

    const res = await POST(
      req({ session_id: 'real-sess', chat_id: 'chat-1', content: 'hi' }) as never
    );
    expect(ownerMaybeSingle).toHaveBeenCalled();
    expect(res.status).toBe(404);
    expect(messagesInsert).not.toHaveBeenCalled();
  });
});
