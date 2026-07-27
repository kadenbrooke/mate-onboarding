import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn().mockResolvedValue({ data: [{ id: 'x' }], error: null });
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ insert: (rows: unknown) => ({ select: () => insertMock(rows) }) }),
  }),
}));

import { POST } from './route';

function req(body: unknown, token?: string) {
  return new Request('http://x/api/leads/ingest', {
    method: 'POST',
    headers: token ? { 'x-ingest-token': token, 'content-type': 'application/json' }
                   : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/leads/ingest', () => {
  beforeEach(() => { process.env.LEADS_INGEST_TOKEN = 'tok'; insertMock.mockClear(); });

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
    const res = await POST(req({ session_id: 'a', leads: [] }) as never);
    expect(res.status).toBe(401);
  });

  it('returns 500 with db error message on insert failure', async () => {
    insertMock.mockResolvedValueOnce({ data: null, error: { message: 'db failure' } });
    const res = await POST(req({
      session_id: '11111111-1111-1111-1111-111111111111',
      leads: [{ name: 'Test' }],
    }, 'tok') as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'db failure' });
  });
});
