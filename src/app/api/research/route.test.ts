// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Fake site and session only. Nothing leaves the test.
const h = vi.hoisted(() => ({ gate: vi.fn(), fetchSite: vi.fn(), writes: [] as { id: string; row: unknown }[] }));
vi.mock('@/lib/portal/onboarding-gate', () => ({ checkOnboardingAccess: (_req: Request, id: string) => h.gate(id) }));
vi.mock('@/lib/research/website', () => ({
  fetchSite: (url: string) => h.fetchSite(url),
  extractBrandFromHtml: () => ({ colors: [] }),
  resolveBrandColors: async (b: unknown) => b,
  extractCompanyData: async () => ({ name: 'Fake Paving Co' }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      let row: unknown = null;
      const chain = {
        select: () => chain,
        update: (r: unknown) => { row = r; return chain; },
        eq: (_c: string, id: string) => {
          if (row) { h.writes.push({ id, row }); return Promise.resolve({ error: null }); }
          return chain;
        },
        maybeSingle: async () => ({ data: { collected: {}, mate_name: null }, error: null }),
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

const OWN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const send = (body: unknown) => POST(new NextRequest('http://x/api/research', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  h.gate.mockReset();
  h.fetchSite.mockReset();
  h.fetchSite.mockResolvedValue({ html: '<h1>Fake Paving Co</h1>', finalUrl: 'https://fake.example' });
  h.writes = [];
});

describe('POST /api/research', () => {
  it("refuses to save into another tenant's session, before scraping", async () => {
    h.gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const res = await send({ url: 'fake.example', sessionId: OTHER });
    expect(res.status).toBe(403);
    expect(h.gate).toHaveBeenCalledWith(OTHER);
    expect(h.fetchSite).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it('saves the result into its own session', async () => {
    h.gate.mockResolvedValue({ ok: true, access: 'creator' });
    const res = await send({ url: 'fake.example', sessionId: OWN });
    expect(res.status).toBe(200);
    expect(h.writes.map(w => w.id)).toEqual([OWN]);
  });

  it('needs no session to research a url without saving it', async () => {
    const res = await send({ url: 'fake.example' });
    expect(res.status).toBe(200);
    expect(h.gate).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
});
