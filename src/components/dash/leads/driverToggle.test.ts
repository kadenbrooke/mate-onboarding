import { describe, it, expect, vi } from 'vitest';
import { normalizeHandler, nextHandler, toggleHandler } from './driverToggle';

describe('normalizeHandler', () => {
  it('maps human to human and everything else (incl. null) to agent', () => {
    expect(normalizeHandler('human')).toBe('human');
    expect(normalizeHandler('agent')).toBe('agent');
    expect(normalizeHandler(null)).toBe('agent');
    expect(normalizeHandler(undefined)).toBe('agent');
    expect(normalizeHandler('garbage')).toBe('agent');
  });
});

describe('nextHandler', () => {
  it('flips agent <-> human', () => {
    expect(nextHandler('agent')).toBe('human');
    expect(nextHandler('human')).toBe('agent');
  });
});

describe('toggleHandler', () => {
  const okFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;

  it('optimistically applies the target then commits on success', async () => {
    const applied: string[] = [];
    const res = await toggleHandler({
      leadId: 'l1', sessionId: 's1', current: 'agent',
      apply: (h) => applied.push(h),
      fetchImpl: okFetch,
    });
    // Applied forward to human exactly once; no revert.
    expect(applied).toEqual(['human']);
    expect(res).toEqual({ ok: true, handler: 'human' });
  });

  it('PATCHes the handler endpoint with the toggled value', async () => {
    const spy = vi.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    await toggleHandler({ leadId: 'l9', sessionId: 's2', current: 'human', apply: () => {}, fetchImpl: spy });
    expect(spy).toHaveBeenCalledWith('/api/leads/l9/handler', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ session_id: 's2', handler: 'agent' }),
    }));
  });

  it('reverts to the original state when the PATCH returns a non-ok status', async () => {
    const applied: string[] = [];
    const errors: string[] = [];
    const badFetch = vi.fn(async () => new Response('{"error":"boom"}', { status: 500 })) as unknown as typeof fetch;
    const res = await toggleHandler({
      leadId: 'l1', sessionId: 's1', current: 'agent',
      apply: (h) => applied.push(h),
      onError: (m) => errors.push(m),
      fetchImpl: badFetch,
    });
    // forward to human, then revert to agent
    expect(applied).toEqual(['human', 'agent']);
    expect(res.ok).toBe(false);
    expect(res.handler).toBe('agent');
    expect(errors).toHaveLength(1);
  });

  it('reverts and reports an error when the request throws (network failure)', async () => {
    const applied: string[] = [];
    const errors: string[] = [];
    const throwFetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const res = await toggleHandler({
      leadId: 'l1', sessionId: 's1', current: 'human',
      apply: (h) => applied.push(h),
      onError: (m) => errors.push(m),
      fetchImpl: throwFetch,
    });
    expect(applied).toEqual(['agent', 'human']); // forward then revert
    expect(res.ok).toBe(false);
    expect(res.handler).toBe('human');
    expect(errors).toHaveLength(1);
  });
});
