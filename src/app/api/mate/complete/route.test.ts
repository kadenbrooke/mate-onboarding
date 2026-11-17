// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Fake data only. An allowed request reaches the session read; the read answers
// "not found", which ends the request at 404 before anything is provisioned.
const h = vi.hoisted(() => ({ gate: vi.fn(), reads: [] as string[], tables: [] as string[] }));
vi.mock('@/lib/portal/onboarding-gate', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/portal/onboarding-gate')>()),
  checkOnboardingAccess: (_req: Request, id: string) => h.gate(id),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      h.tables.push(table);
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

import { POST } from './route';

const OWN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const send = (sessionId: string) =>
  POST(new NextRequest('http://x/api/mate/complete', { method: 'POST', body: JSON.stringify({ sessionId }) }));

beforeEach(() => {
  h.gate.mockReset();
  h.reads = [];
  h.tables = [];
});

describe('POST /api/mate/complete', () => {
  it("refuses another tenant's session before touching any table", async () => {
    h.gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const res = await send(OTHER);
    expect(res.status).toBe(403);
    expect(h.gate).toHaveBeenCalledWith(OTHER);
    expect(h.tables).toEqual([]);
  });

  it('never provisions the public demo session', async () => {
    h.gate.mockResolvedValue({ ok: true, access: 'demo' });
    const res = await send(OWN);
    expect(res.status).toBe(403);
    expect(h.tables).toEqual([]);
  });

  it('lets the creator through to its own session', async () => {
    h.gate.mockResolvedValue({ ok: true, access: 'creator' });
    const res = await send(OWN);
    expect(h.reads).toEqual([OWN]);
    expect(res.status).toBe(404);
  });
});
