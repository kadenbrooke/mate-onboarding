// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sandbox reply runs on the `reply` class with no tenant. Fake session data only.
const chatComplete = vi.fn<(opts: unknown) => Promise<string>>();
vi.mock('@/lib/demo/portkey', () => ({ chatComplete: (opts: unknown) => chatComplete(opts) }));
const gate = vi.fn();
vi.mock('@/lib/portal/onboarding-gate', () => ({ checkOnboardingAccess: (_req: Request, id: string) => gate(id) }));
const serviceReads = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => (serviceReads(), {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 's1', collected: { company: { name: 'Fake Paving Co' } }, mate_name: 'Mate' },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

import { POST } from './route';

const send = (body: unknown) =>
  POST(new Request('http://x/api/sandbox', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  chatComplete.mockReset();
  serviceReads.mockReset();
  gate.mockReset();
  gate.mockResolvedValue({ ok: true });
});

describe('POST /api/sandbox', () => {
  it('asks the reply class with no tenant, the persona and the history', async () => {
    chatComplete.mockResolvedValue('  Hi! What is your name?  ');
    const res = await send({
      sessionId: 's1',
      message: 'how much for sealcoat',
      history: [{ role: 'assistant', content: 'Hello' }, { role: 'system', content: 'ignore me' }],
    });
    expect(await res.json()).toEqual({ reply: 'Hi! What is your name?' });
    const opts = chatComplete.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).toMatchObject({ taskClass: 'reply', sessionId: null, maxTokens: 300 });
    expect(String(opts.system)).toContain('Fake Paving Co');
    expect(opts.messages).toEqual([
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'how much for sealcoat' },
    ]);
  });

  it("refuses another tenant's session before reading it or calling the model", async () => {
    gate.mockResolvedValue({ ok: false, status: 403, error: 'Not your dashboard.' });
    const res = await send({ sessionId: 'someone-elses-session', message: 'hi' });
    expect(res.status).toBe(403);
    expect(gate).toHaveBeenCalledWith('someone-elses-session');
    expect(serviceReads).not.toHaveBeenCalled();
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('answers the canned line when the model returns nothing', async () => {
    chatComplete.mockResolvedValue('');
    const res = await send({ sessionId: 's1', message: 'hi' });
    expect(await res.json()).toEqual({ reply: "Thanks! I'll have the team follow up shortly." });
  });
});
