// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Fake session data only. The gate is mocked; onboarding-gate.test.ts covers its rules.
const h = vi.hoisted(() => ({ gate: vi.fn(), reads: [] as string[], writes: [] as unknown[] }));
vi.mock('@/lib/portal/onboarding-gate', () => ({ checkOnboardingAccess: (_req: Request, id: string) => h.gate(id) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }) }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      let id = '';
      const chain = {
        select: () => chain,
        update: (row: unknown) => { h.writes.push(row); return chain; },
        eq: (_c: string, v: string) => { id = v; return chain; },
        maybeSingle: async () => {
          h.reads.push(id);
          return { data: { id, mate_name: 'Mate', website_url: null, brand: null, step: 'chat', messages: [], collected: { company: { name: 'Fake Co' }, ein: '12-3456789' } }, error: null };
        },
      };
      return chain;
    },
  }),
}));

import { GET, PATCH } from './route';

const OWN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const get = (id: string) => GET(new NextRequest(`http://x/api/session?id=${id}`));
const patch = (body: unknown) => PATCH(new NextRequest('http://x/api/session', { method: 'PATCH', body: JSON.stringify(body) }));

beforeEach(() => {
  h.gate.mockReset();
  h.reads = [];
  h.writes = [];
});

describe('GET /api/session', () => {
  it("refuses another tenant's session before reading it", async () => {
    h.gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const res = await get(OTHER);
    expect(res.status).toBe(403);
    expect(h.gate).toHaveBeenCalledWith(OTHER);
    expect(h.reads).toEqual([]);
  });

  it('returns its own session, EIN masked', async () => {
    h.gate.mockResolvedValue({ ok: true, access: 'creator' });
    const res = await get(OWN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(OWN);
    expect(body.collected.company.name).toBe('Fake Co');
    expect(JSON.stringify(body)).not.toContain('3456789');
    expect(body).not.toHaveProperty('is_demo');
  });
});

describe('PATCH /api/session', () => {
  it("refuses a write to another tenant's session before reading or writing", async () => {
    h.gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const res = await patch({ id: OTHER, step: 'review', collected: { services: ['x'] } });
    expect(res.status).toBe(403);
    expect(h.reads).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  it('writes its own session', async () => {
    h.gate.mockResolvedValue({ ok: true, access: 'member' });
    const res = await patch({ id: OWN, step: 'review' });
    expect(res.status).toBe(200);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ step: 'review' });
  });
});
