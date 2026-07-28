import { describe, it, expect, vi } from 'vitest';

const eqMock = vi.fn().mockResolvedValue({ error: null });
const updateMock = vi.fn(() => ({ eq: () => ({ eq: eqMock }) }));
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
    const res = await PATCH(req({ status: 'won', session_id: 's1' }) as never, { params });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'won' }));
  });
});
