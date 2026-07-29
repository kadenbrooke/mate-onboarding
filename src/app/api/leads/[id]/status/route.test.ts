import { describe, it, expect, vi } from 'vitest';

// Track eq args for the leads update chain only.
const eqArgs: unknown[][] = [];
const eq2 = vi.fn((...a: unknown[]) => { eqArgs.push(a); return Promise.resolve({ error: null }); });
const eq1 = vi.fn((...a: unknown[]) => { eqArgs.push(a); return { eq: eq2 }; });
const updateMock = vi.fn(() => ({ eq: eq1 }));

// Session select chain: default returns a demo session so existing tests need
// no auth mock. Individual tests override via mockResolvedValueOnce.
const maybeSingleMock = vi.fn(() => Promise.resolve({ data: { is_demo: true }, error: null }));
const sessionEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: sessionEqMock }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === 'onboarding_sessions'
        ? { select: selectMock }
        : { update: updateMock },
  }),
}));

// Auth client mock — default: no user (demo sessions don't reach this path).
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: null } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

import { PATCH } from './route';

const req = (body: unknown) => new Request('http://x', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const params = Promise.resolve({ id: 'lead-1' });

describe('PATCH /api/leads/[id]/status', () => {
  it('rejects invalid status with 400', async () => {
    const res = await PATCH(req({ status: 'banana', session_id: 's1' }) as never, { params });
    expect(res.status).toBe(400);
  });

  it('rejects missing session_id with 400', async () => {
    const res = await PATCH(req({ status: 'won' }) as never, { params });
    expect(res.status).toBe(400);
  });

  it('updates status scoped to session (demo session, no auth needed)', async () => {
    eqArgs.length = 0;
    maybeSingleMock.mockResolvedValueOnce({ data: { is_demo: true }, error: null });
    const res = await PATCH(req({ status: 'won', session_id: 's1' }) as never, { params });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'won' }));
    expect(eqArgs).toContainEqual(['id', 'lead-1']);
    expect(eqArgs).toContainEqual(['session_id', 's1']);
  });

  it('allows non-demo session when user is signed in', async () => {
    eqArgs.length = 0;
    maybeSingleMock.mockResolvedValueOnce({ data: { is_demo: false }, error: null });
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1' } } } as never);
    const res = await PATCH(req({ status: 'lost', session_id: 's2' }) as never, { params });
    expect(res.status).toBe(200);
  });

  it('rejects non-demo session when no user is signed in', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { is_demo: false }, error: null });
    getUserMock.mockResolvedValueOnce({ data: { user: null } } as never);
    const res = await PATCH(req({ status: 'won', session_id: 's3' }) as never, { params });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Sign in required.');
  });

  it('returns 404 when session is not found', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const res = await PATCH(req({ status: 'won', session_id: 'missing' }) as never, { params });
    expect(res.status).toBe(404);
  });

  it('returns 400 for unparseable body', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: 'not-json' }) as never, { params });
    expect(res.status).toBe(400);
  });
});
