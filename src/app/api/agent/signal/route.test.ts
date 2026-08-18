import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn(() => ({
  select: () => ({ single: () => Promise.resolve({ data: { id: 'sig-1', created_at: '2026-08-17T18:00:00.000Z' }, error: null }) }),
}));
// Derived ticker rows the route mirrors into client_events.
const emitted: Record<string, unknown>[] = [];
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: insertMock,
      upsert: (v: unknown) => { emitted.push(v as Record<string, unknown>); return Promise.resolve({ error: null }); },
    }),
  }),
}));

import { POST, OPTIONS } from './route';

const post = (qs: string) =>
  POST(new Request(`http://x/api/agent/signal?${qs}`, { method: 'POST' }) as never);

beforeEach(() => { process.env.SIGNAL_TOKEN = 'sig'; insertMock.mockClear(); emitted.length = 0; });

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
  // handoff_signals is also the sink for internal readiness pings from the e2e
  // preview page, and a client must never see one of those in their ticker.
  it('does not put an internal readiness ping in the client ticker', async () => {
    await post('k=sig&kind=operator_flip_ready&session_id=s1&note=done');
    expect(emitted).toHaveLength(0);
  });

  it('mirrors a real handoff into the client ticker', async () => {
    const res = await post('k=sig&kind=operator_flip&session_id=s1');
    expect(res.status).toBe(200);
    expect(emitted).toEqual([expect.objectContaining({
      session_id: 's1', agent: 'first_responder', kind: 'handoff',
      message: 'Handed the conversation over to your team',
      source_key: 'signal:sig-1',
    })]);
  });

  it('OPTIONS preflight returns CORS 204', async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
