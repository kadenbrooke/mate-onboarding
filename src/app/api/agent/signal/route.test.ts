import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: () => ({ insert: insertMock }) }),
}));

import { POST, OPTIONS } from './route';

const post = (qs: string) =>
  POST(new Request(`http://x/api/agent/signal?${qs}`, { method: 'POST' }) as never);

beforeEach(() => { process.env.SIGNAL_TOKEN = 'sig'; insertMock.mockClear(); });

describe('POST /api/agent/signal', () => {
  it('401s without the token', async () => {
    expect((await post('kind=operator_flip_ready')).status).toBe(401);
  });
  it('400s without a kind', async () => {
    expect((await post('k=sig')).status).toBe(400);
  });
  it('records the signal with a valid token', async () => {
    const res = await post('k=sig&kind=operator_flip_ready&session_id=s1&note=done');
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'operator_flip_ready', session_id: 's1', note: 'done' }),
    );
  });
  it('OPTIONS preflight returns CORS 204', async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
