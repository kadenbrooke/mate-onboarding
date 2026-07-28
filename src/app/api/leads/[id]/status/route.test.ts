import { describe, it, expect, vi } from 'vitest';

const eqArgs: unknown[][] = [];
const eq2 = vi.fn((...a: unknown[]) => { eqArgs.push(a); return Promise.resolve({ error: null }); });
const eq1 = vi.fn((...a: unknown[]) => { eqArgs.push(a); return { eq: eq2 }; });
const updateMock = vi.fn(() => ({ eq: eq1 }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: () => ({ update: updateMock }) }),
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

  it('updates status scoped to session', async () => {
    eqArgs.length = 0;
    const res = await PATCH(req({ status: 'won', session_id: 's1' }) as never, { params });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'won' }));
    expect(eqArgs).toContainEqual(['id', 'lead-1']);
    expect(eqArgs).toContainEqual(['session_id', 's1']);
  });

  it('returns 400 for unparseable body', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: 'not-json' }) as never, { params });
    expect(res.status).toBe(400);
  });
});
