import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emitClientEvent } from './clientEvents';
import type { ClientEventInsert } from '@/lib/metrics/eventSources';

const event: ClientEventInsert = {
  session_id: 's-1',
  agent: 'first_responder',
  kind: 'call',
  message: 'Checked in after your call with (801) 224-0797',
  created_at: '2026-08-11T19:27:31.648Z',
  source_key: 'postcall:pc1:opened',
  lead_key: '8012240797',
};

function sink(result: { error: { message: string } | null } | Error) {
  const calls: Array<{ table: string; values: unknown; options: unknown }> = [];
  const supabase = {
    from: (table: string) => ({
      upsert: (values: unknown, options: unknown) => {
        calls.push({ table, values, options });
        if (result instanceof Error) return Promise.reject(result);
        return Promise.resolve(result);
      },
    }),
  };
  return { calls, supabase };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

describe('emitClientEvent', () => {
  it('writes the row to client_events', async () => {
    const s = sink({ error: null });
    const out = await emitClientEvent(s.supabase as never, event);
    expect(out).toEqual({ emitted: true, error: null });
    expect(s.calls[0].table).toBe('client_events');
    expect(s.calls[0].values).toEqual(event);
  });

  // source_key carries a unique index (migration 0013). Ignore-on-conflict is
  // what makes a webhook retry, a re-fired trigger, and a re-run backfill all
  // land exactly one ticker line.
  it('is an ignore-on-conflict upsert keyed on source_key', () => {
    const s = sink({ error: null });
    void emitClientEvent(s.supabase as never, event);
    expect(s.calls[0].options).toEqual({ onConflict: 'source_key', ignoreDuplicates: true });
  });

  it('does nothing for a null event, so callers can pass a mapper result straight through', async () => {
    const s = sink({ error: null });
    const out = await emitClientEvent(s.supabase as never, null);
    expect(out).toEqual({ emitted: false, error: null });
    expect(s.calls).toHaveLength(0);
  });

  // The whole point of the helper: the activity feed is a MIRROR of work that
  // already happened. A failure to mirror must never fail the postcall or
  // signal request that did the actual work.
  it('reports a database error instead of throwing', async () => {
    const s = sink({ error: { message: 'permission denied for table client_events' } });
    await expect(emitClientEvent(s.supabase as never, event))
      .resolves.toEqual({ emitted: false, error: 'permission denied for table client_events' });
  });

  it('swallows a transport failure instead of rejecting', async () => {
    const s = sink(new Error('fetch failed'));
    await expect(emitClientEvent(s.supabase as never, event))
      .resolves.toEqual({ emitted: false, error: 'fetch failed' });
  });
});
