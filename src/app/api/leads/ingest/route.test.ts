import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const insertMock = vi.fn().mockResolvedValue({ data: [{ id: 'x' }], error: null });

// The route now looks the session up before inserting, so the mock has to
// dispatch on table name: onboarding_sessions resolves the is_demo guard,
// client_leads takes the insert.
const sessionLookup = vi.fn().mockResolvedValue({ data: { is_demo: false }, error: null });

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'onboarding_sessions') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => sessionLookup() }) }),
        };
      }
      return { insert: (rows: unknown) => ({ select: () => insertMock(rows) }) };
    },
  }),
}));

import { POST } from './route';

function req(body: unknown, token?: string): NextRequest {
  return new Request('http://x/api/leads/ingest', {
    method: 'POST',
    headers: token ? { 'x-ingest-token': token, 'content-type': 'application/json' }
                   : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/leads/ingest', () => {
  beforeEach(() => {
    process.env.LEADS_INGEST_TOKEN = 'tok';
    insertMock.mockClear();
    sessionLookup.mockClear();
    sessionLookup.mockResolvedValue({ data: { is_demo: false }, error: null });
  });

  it('rejects missing/wrong token with 401', async () => {
    const res = await POST(req({ session_id: 'a', leads: [] }, 'wrong'));
    expect(res.status).toBe(401);
  });

  it('rejects payload without session_id or leads array with 400', async () => {
    const res = await POST(req({ leads: [] }, 'tok'));
    expect(res.status).toBe(400);
  });

  it('inserts rows scoped to session_id and returns count', async () => {
    const res = await POST(req({
      session_id: '11111111-1111-1111-1111-111111111111',
      leads: [{ name: 'Mike R.', source: 'missed_call', score: 92, quote_cents: 1840000 }],
    }, 'tok'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 1 });
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ session_id: '11111111-1111-1111-1111-111111111111', name: 'Mike R.' }),
    ]);
  });

  it('strips unknown fields from lead rows', async () => {
    await POST(req({
      session_id: '11111111-1111-1111-1111-111111111111',
      leads: [{ name: 'A', evil: 'drop-me' }],
    }, 'tok'));
    const rows = insertMock.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0]).not.toHaveProperty('evil');
  });

  it('rejects absent token header with 401', async () => {
    const res = await POST(req({ session_id: 'a', leads: [] }));
    expect(res.status).toBe(401);
  });

  it('refuses to write real leads to an is_demo session', async () => {
    sessionLookup.mockResolvedValue({ data: { is_demo: true }, error: null });
    const res = await POST(req({
      session_id: '11111111-1111-1111-1111-111111111111',
      leads: [{ name: 'Real Person', phone: '+18015551234' }],
    }, 'tok'));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('allows seeding an is_demo session when allow_demo is set', async () => {
    sessionLookup.mockResolvedValue({ data: { is_demo: true }, error: null });
    const res = await POST(req({
      session_id: '11111111-1111-1111-1111-111111111111',
      leads: [{ name: 'Todd R.', source: 'missed_call' }],
      allow_demo: true,
    }, 'tok'));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalled();
  });

  it('returns 404 for an unknown session_id', async () => {
    sessionLookup.mockResolvedValue({ data: null, error: null });
    const res = await POST(req({
      session_id: '99999999-9999-9999-9999-999999999999',
      leads: [{ name: 'A' }],
    }, 'tok'));
    expect(res.status).toBe(404);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns 500 with db error message on insert failure', async () => {
    insertMock.mockResolvedValueOnce({ data: null, error: { message: 'db failure' } });
    const res = await POST(req({
      session_id: '11111111-1111-1111-1111-111111111111',
      leads: [{ name: 'Test' }],
    }, 'tok'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'db failure' });
  });
});
