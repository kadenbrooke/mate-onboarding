import { describe, it, expect, vi } from 'vitest';

const eqArgs: unknown[][] = [];
const eq2 = vi.fn((...a: unknown[]) => { eqArgs.push(a); return Promise.resolve({ error: null }); });
const eq1 = vi.fn((...a: unknown[]) => { eqArgs.push(a); return { eq: eq2 }; });
const updateMock = vi.fn(() => ({ eq: eq1 }));
const client = { from: vi.fn(() => ({ update: updateMock })) };

import { setHandler } from './handler';

describe('setHandler', () => {
  it('updates handler + audit fields scoped to lead and session', async () => {
    eqArgs.length = 0;
    await setHandler(client as never, { leadId: 'lead-1', sessionId: 's1', handler: 'human', by: 'dashboard' });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ handler: 'human', handler_changed_by: 'dashboard' }));
    expect((updateMock.mock.calls[0] as unknown[])[0]).toHaveProperty('handler_changed_at');
    expect(eqArgs).toContainEqual(['id', 'lead-1']);
    expect(eqArgs).toContainEqual(['session_id', 's1']);
  });
});
