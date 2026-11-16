// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake session data only. The model is never called: portkeyLanguageModel
// answers ok:false, so an allowed request ends at 503 right after the gate and
// the session read, which proves it got that far.
const gate = vi.fn();
vi.mock('@/lib/portal/onboarding-gate', () => ({ checkOnboardingAccess: (_req: Request, id: string) => gate(id) }));
const model = vi.fn(() => ({ ok: false, detail: 'test' }));
vi.mock('@/lib/demo/portkeyModel', () => ({ portkeyLanguageModel: () => model() }));
const sessionReads = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            sessionReads(id);
            return { data: { id, mate_name: 'Mate', collected: { company: { name: 'Fake Co' } }, messages: [], is_demo: false, contact_id: null }, error: null };
          },
        }),
      }),
    }),
  }),
}));

import { POST } from './route';

const OWN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const send = (body: unknown) =>
  POST(new Request('http://x/api/mate', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  gate.mockReset();
  sessionReads.mockReset();
  model.mockClear();
});

describe('POST /api/mate authorization', () => {
  it("refuses another tenant's session before reading it or building a model", async () => {
    gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const res = await send({ sessionId: OTHER, message: 'hi' });
    expect(res.status).toBe(403);
    expect(gate).toHaveBeenCalledWith(OTHER);
    expect(sessionReads).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller on a real session', async () => {
    gate.mockResolvedValue({ ok: false, status: 401, error: 'Sign in required.' });
    expect((await send({ sessionId: OWN, message: 'hi' })).status).toBe(401);
    expect(sessionReads).not.toHaveBeenCalled();
  });

  it('lets an authorized caller through to its own session', async () => {
    gate.mockResolvedValue({ ok: true });
    const res = await send({ sessionId: OWN, message: 'hi' });
    expect(gate).toHaveBeenCalledWith(OWN);
    expect(sessionReads).toHaveBeenCalledWith(OWN);
    expect(model).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
  });
});
