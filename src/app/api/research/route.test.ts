// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Fake site and session only. The real guarded fetch runs; DNS and the network
// are stubbed, and the Claude extraction is mocked, so nothing leaves the test.
const h = vi.hoisted(() => ({
  gate: vi.fn(),
  lookup: vi.fn(),
  extract: vi.fn(),
  rpc: vi.fn(),
  writes: [] as { id: string; row: unknown }[],
}));
vi.mock('node:dns/promises', () => {
  const shape = { lookup: (...a: unknown[]) => h.lookup(...a) };
  return { ...shape, default: shape };
});
vi.mock('@/lib/portal/onboarding-gate', () => ({ checkOnboardingAccess: (_req: Request, id: string) => h.gate(id) }));
vi.mock('@/lib/research/website', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/research/website')>()),
  resolveBrandColors: async (b: unknown) => b,
  extractCompanyData: (html: string | null) => h.extract(html),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: (...a: unknown[]) => h.rpc(...a),
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
let fetchMock: ReturnType<typeof vi.fn>;
const send = (body: unknown, ip = '203.0.113.7') =>
  POST(new NextRequest('http://x/api/research', { method: 'POST', headers: { 'x-real-ip': ip }, body: JSON.stringify(body) }));

beforeEach(() => {
  h.gate.mockReset();
  h.lookup.mockReset();
  h.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  h.extract.mockReset();
  h.extract.mockResolvedValue({ name: 'Fake Paving Co' });
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: true, error: null });
  h.writes = [];
  fetchMock = vi.fn(async () => new Response('<html><h1>Fake Paving Co</h1></html>', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/research: SSRF guard', () => {
  it.each([
    ['loopback', 'http://127.0.0.1:8080/'],
    ['localhost', 'http://localhost:3000/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['private network', 'http://10.0.0.5/'],
  ])('refuses %s before any fetch or Claude call', async (_label, url) => {
    const res = await send({ url });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.extract).not.toHaveBeenCalled();
  });

  it('refuses a public name that resolves to an internal address', async () => {
    h.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const res = await send({ url: 'https://sneaky.example' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses for a signed-in session too, not only anonymous calls', async () => {
    h.gate.mockResolvedValue({ ok: true, access: 'creator' });
    const res = await send({ url: 'http://169.254.169.254/', sessionId: OWN });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it('researches a normal public site', async () => {
    const res = await send({ url: 'fake.example' });
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://fake.example');
    expect(h.extract).toHaveBeenCalledWith(expect.stringContaining('Fake Paving Co'));
    expect((await res.json()).company).toEqual({ name: 'Fake Paving Co' });
  });
});

describe('POST /api/research: anonymous per-IP limit', () => {
  it('counts every anonymous call against the caller IP', async () => {
    await send({ url: 'fake.example' });
    expect(h.rpc).toHaveBeenCalledWith('demo_counter_bump', expect.objectContaining({ p_scope: 'research_anon_ip', p_cap: 5 }));
  });

  it('answers 429 once the cap is reached, before any fetch or Claude call', async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });
    const res = await send({ url: 'fake.example' });
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.extract).not.toHaveBeenCalled();
  });

  it('does not count an authorized session call against the limit', async () => {
    h.gate.mockResolvedValue({ ok: true, access: 'creator' });
    const res = await send({ url: 'fake.example', sessionId: OWN });
    expect(res.status).toBe(200);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.writes.map(w => w.id)).toEqual([OWN]);
  });
});

describe('POST /api/research: session authorization', () => {
  it("refuses to save into another tenant's session, before scraping", async () => {
    h.gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const res = await send({ url: 'fake.example', sessionId: OTHER });
    expect(res.status).toBe(403);
    expect(h.gate).toHaveBeenCalledWith(OTHER);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
});
