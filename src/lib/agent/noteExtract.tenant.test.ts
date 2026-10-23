import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// The note extractor runs on the lead's tenant key: the session id it was
// handed (the lead's own session) must reach chatComplete unchanged.
const chatComplete = vi.fn<(opts: unknown) => Promise<string>>(async () => '{"city":"Lehi"}');
vi.mock('@/lib/demo/portkey', () => ({ chatComplete: (opts: unknown) => chatComplete(opts) }));

import { applyNoteToLead, extractNoteFields } from './noteExtract';

beforeEach(() => chatComplete.mockClear());

describe('note extraction tenant key', () => {
  it('extractNoteFields passes the session it was given', async () => {
    await extractNoteFields('in Lehi', 'session-x');
    expect(chatComplete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-x' }));
  });

  it("applyNoteToLead uses the lead's session", async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      update: () => chain,
      maybeSingle: async () => ({ data: { city: null } }),
    };
    const supabase = { from: () => chain } as unknown as SupabaseClient;
    await applyNoteToLead(supabase, { leadId: 'l1', sessionId: 'session-y', note: 'in Lehi' });
    expect(chatComplete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-y' }));
  });
});
