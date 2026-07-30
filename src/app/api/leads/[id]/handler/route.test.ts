import { describe, it, expect, vi } from 'vitest';
const eqA: unknown[][] = [];
const eq2 = vi.fn((...a: unknown[]) => { eqA.push(a); return Promise.resolve({ error: null }); });
const eq1 = vi.fn((...a: unknown[]) => { eqA.push(a); return { eq: eq2 }; });
const updateMock = vi.fn(() => ({ eq: eq1 }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: () => ({ update: updateMock }) }) }));
import { PATCH } from './route';
const req = (b: unknown) => new Request('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const params = Promise.resolve({ id: 'lead-1' });

describe('PATCH /api/leads/[id]/handler', () => {
  it('rejects a bad handler value', async () => {
    expect((await PATCH(req({ handler: 'robot', session_id: 's1' }) as never, { params })).status).toBe(400);
  });
  it('sets handler=agent scoped to session', async () => {
    eqA.length = 0;
    const res = await PATCH(req({ handler: 'agent', session_id: 's1' }) as never, { params });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ handler: 'agent', handler_changed_by: 'dashboard' }));
    expect(eqA).toContainEqual(['session_id', 's1']);
  });
});
