import { describe, it, expect, vi, beforeEach } from 'vitest';

// Delete chain: .delete({count}).eq(id).eq(session_id) -> { error, count }
const deleteEqArgs: unknown[][] = [];
let deleteResult: { error: { message: string } | null; count: number } = { error: null, count: 1 };
const eq2 = vi.fn((...a: unknown[]) => { deleteEqArgs.push(a); return Promise.resolve(deleteResult); });
const eq1 = vi.fn((...a: unknown[]) => { deleteEqArgs.push(a); return { eq: eq2 }; });
const deleteMock = vi.fn(() => ({ eq: eq1 }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: () => ({ delete: deleteMock }) }),
}));

const verdict = vi.fn(() => Promise.resolve({ ok: true, access: 'member' as const }));
vi.mock('@/lib/portal/api-gate', () => ({ checkDashApiAccess: (id: string) => verdict(id) }));

import { DELETE } from './route';

const params = Promise.resolve({ id: 'lead-1' });
const req = (qs: string) => new Request(`http://x/api/leads/lead-1${qs}`, { method: 'DELETE' });

beforeEach(() => {
  deleteEqArgs.length = 0;
  deleteResult = { error: null, count: 1 };
  verdict.mockClear();
  verdict.mockResolvedValue({ ok: true, access: 'member' as const });
});

describe('DELETE /api/leads/[id]', () => {
  it('requires session_id', async () => {
    const res = await DELETE(req('') as never, { params });
    expect(res.status).toBe(400);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('refuses a caller who does not hold access to the session', async () => {
    verdict.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' } as never);
    const res = await DELETE(req('?session_id=s1') as never, { params });
    expect(res.status).toBe(403);
    // Authorization is checked BEFORE any destructive call is made.
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('deletes scoped to both the lead id and its session', async () => {
    const res = await DELETE(req('?session_id=s1') as never, { params });
    expect(res.status).toBe(200);
    expect(verdict).toHaveBeenCalledWith('s1');
    expect(deleteEqArgs).toEqual([['id', 'lead-1'], ['session_id', 's1']]);
  });

  it('404s when the lead is not in that session', async () => {
    deleteResult = { error: null, count: 0 };
    const res = await DELETE(req('?session_id=s1') as never, { params });
    expect(res.status).toBe(404);
  });

  it('surfaces a DB error as a 500', async () => {
    deleteResult = { error: { message: 'boom' }, count: 0 };
    const res = await DELETE(req('?session_id=s1') as never, { params });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('boom');
  });
});
