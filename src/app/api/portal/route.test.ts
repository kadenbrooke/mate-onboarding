// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Fake data only. An allowed request reads the session; "not found" answers the
// empty (unfinished) portal with 200.
const h = vi.hoisted(() => ({ gate: vi.fn(), reads: [] as string[] }));
vi.mock('@/lib/portal/onboarding-gate', () => ({ checkOnboardingAccess: (_req: Request, id: string) => h.gate(id) }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      let id = '';
      const chain = {
        select: () => chain,
        eq: (_c: string, v: string) => { id = v; return chain; },
        maybeSingle: async () => { h.reads.push(id); return { data: null, error: null }; },
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

const OWN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const get = (id: string) => GET(new NextRequest(`http://x/api/portal?session=${id}`));

beforeEach(() => {
  h.gate.mockReset();
  h.reads = [];
});

describe('GET /api/portal', () => {
  it("refuses another tenant's portal before reading it", async () => {
    h.gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const res = await get(OTHER);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Not your dashboard.' });
    expect(h.gate).toHaveBeenCalledWith(OTHER);
    expect(h.reads).toEqual([]);
  });

  it('serves its own portal', async () => {
    h.gate.mockResolvedValue({ ok: true, access: 'member' });
    const res = await get(OWN);
    expect(res.status).toBe(200);
    expect(h.reads).toEqual([OWN]);
  });
});
