import { describe, it, expect, vi } from 'vitest';
import { buildQuoteOutcomeMenu, applyQuoteOutcome, runQuoteMenuScan } from './quoteOutcome';

function makeDeps() {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from: (t: string) => {
      expect(t).toBe('jc_sms_conversations');
      return { update: (v: Record<string, unknown>) => { updates.push(v); return { eq: () => Promise.resolve({ error: null }) }; } };
    },
  };
  const logNote = vi.fn(async (_n: string) => {});
  const now = () => new Date('2026-08-04T18:00:00.000Z');
  return { updates, supabase, logNote, now };
}

describe('buildQuoteOutcomeMenu', () => {
  it('offers 1-4 and contains no em dash', () => {
    const menu = buildQuoteOutcomeMenu();
    for (const n of ['1', '2', '3', '4']) expect(menu).toContain(n);
    expect(menu).not.toContain('—');
  });
});

describe('applyQuoteOutcome', () => {
  it('1 Won sets status=won, won_at, campaign=none', async () => {
    const d = makeDeps();
    const { patch } = await applyQuoteOutcome('1', null, { conversationId: 'c1', supabase: d.supabase as never, now: d.now });
    expect(patch).toMatchObject({ status: 'won', campaign: 'none', won_at: '2026-08-04T18:00:00.000Z' });
    expect(d.updates[0]).toMatchObject({ status: 'won' });
  });

  it('2 Thinking starts Drip B (post_quote, stage 0, due +1d)', async () => {
    const d = makeDeps();
    const { patch } = await applyQuoteOutcome('2', null, { conversationId: 'c1', supabase: d.supabase as never, now: d.now });
    expect(patch).toMatchObject({ status: 'quoted_thinking', campaign: 'post_quote', nurture_stage: 0 });
    expect(patch.next_drip_due_at).toBe('2026-08-05T18:00:00.000Z');
  });

  it('3 Lost sets status=lost, lost_at, campaign=none', async () => {
    const d = makeDeps();
    const { patch } = await applyQuoteOutcome('3', null, { conversationId: 'c1', supabase: d.supabase as never, now: d.now });
    expect(patch).toMatchObject({ status: 'lost', campaign: 'none', lost_at: '2026-08-04T18:00:00.000Z' });
  });

  it('4 Ignore makes no state change (empty patch, no update issued)', async () => {
    const d = makeDeps();
    const { patch } = await applyQuoteOutcome('4', null, { conversationId: 'c1', supabase: d.supabase as never, now: d.now });
    expect(patch).toEqual({});
    expect(d.updates.length).toBe(0);
  });

  it('logs notes whenever present, regardless of choice', async () => {
    const d = makeDeps();
    await applyQuoteOutcome('4', 'they want to compare quotes', { conversationId: 'c1', supabase: d.supabase as never, now: d.now, logNote: d.logNote });
    expect(d.logNote).toHaveBeenCalledWith('they want to compare quotes');
  });

  it('does not call logNote when notes is null', async () => {
    const d = makeDeps();
    await applyQuoteOutcome('1', null, { conversationId: 'c1', supabase: d.supabase as never, now: d.now, logNote: d.logNote });
    expect(d.logNote).not.toHaveBeenCalled();
  });
});

// A chainable Supabase stub for the scan. Each table draws results (for both an
// awaited query and .maybeSingle()) from a per-table FIFO queue; insert/update no-op.
function makeScanSupabase(script: Record<string, Array<{ data: unknown }>>) {
  const queues: Record<string, Array<{ data: unknown }>> = { ...script };
  const inserts: Array<{ table: string; v: unknown }> = [];
  function builder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    Object.assign(b, {
      select: chain, eq: chain, lte: chain, not: chain,
      insert: (v: unknown) => { inserts.push({ table, v }); return Promise.resolve({ error: null }); },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      maybeSingle: () => Promise.resolve(queues[table].shift() ?? { data: null }),
      then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(queues[table].shift() ?? { data: [] }).then(res, rej),
    });
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) }, inserts };
}

describe('runQuoteMenuScan', () => {
  const base = { sessionId: 's1', operatorPhone: '+18019414398', now: () => new Date('2026-08-04T18:00:00.000Z') };

  it('defers (sends nothing) inside quiet hours', async () => {
    const sendSms = vi.fn(async () => ({ ok: true }));
    const { supabase } = makeScanSupabase({});
    const r = await runQuoteMenuScan({ ...base, supabase: supabase as never, sendSms, withinWindow: false });
    expect(r).toEqual({ opened: 0, reasked: 0, deferred: true });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('opens a menu for a due quote with no existing open menu', async () => {
    const sendSms = vi.fn(async () => ({ ok: true }));
    const { supabase, inserts } = makeScanSupabase({
      jc_sms_conversations: [{ data: [{ from_number: '+18015551234' }] }],
      lead_postcall: [{ data: null }, { data: [] }], // existence check (none), then reask scan (none)
    });
    const r = await runQuoteMenuScan({ ...base, supabase: supabase as never, sendSms, withinWindow: true });
    expect(r).toMatchObject({ opened: 1, reasked: 0, deferred: false });
    expect(sendSms).toHaveBeenCalledWith('+18019414398', expect.stringContaining('How did the meeting go?'));
    // jc_conversation_id must carry the conversation's from_number (its natural key),
    // not an `id` (jc_sms_conversations has no id column).
    expect(inserts[0]).toMatchObject({ table: 'lead_postcall', v: { kind: 'quote', jc_conversation_id: '+18015551234', session_id: 's1' } });
  });

  it('re-sends one due choice-4 re-ask and clears it', async () => {
    const sendSms = vi.fn(async () => ({ ok: true }));
    const { supabase } = makeScanSupabase({
      jc_sms_conversations: [{ data: [] }],
      lead_postcall: [{ data: [{ id: 'pc1' }] }], // reask scan yields one due
    });
    const r = await runQuoteMenuScan({ ...base, supabase: supabase as never, sendSms, withinWindow: true });
    expect(r).toMatchObject({ opened: 0, reasked: 1 });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Regression guard: exercise the REAL column names against jc_sms_conversations.
//
// The prior bug read/wrote a non-existent `jc_sms_conversations.id` column, which
// PostgREST rejects with HTTP 400 / 42703 at runtime. The other unit tests here use
// arg-ignoring stubs, so they stayed green while the live route was broken. These
// tests record the exact column strings passed to .select()/.eq() and fail if `id`
// is ever reintroduced for jc_sms_conversations. `from_number` is that table's
// natural key (it has no `id` column in the live schema).
// ---------------------------------------------------------------------------

/** Records every .select()/.eq() column string per table, replaying queued data. */
function makeRecordingSupabase(script: Record<string, Array<{ data: unknown }>>) {
  const queues: Record<string, Array<{ data: unknown }>> = { ...script };
  const selects: Array<{ table: string; col: string }> = [];
  const eqs: Array<{ table: string; col: string }> = [];
  function builder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: (col: string) => { selects.push({ table, col }); return b; },
      eq: (col: string) => { eqs.push({ table, col }); return b; },
      lte: () => b,
      not: () => b,
      insert: () => Promise.resolve({ error: null }),
      update: () => b,
      maybeSingle: () => Promise.resolve((queues[table] ?? []).shift() ?? { data: null }),
      then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve((queues[table] ?? []).shift() ?? { data: [] }).then(res, rej),
    });
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) }, selects, eqs };
}

describe('jc_sms_conversations real-column guard', () => {
  const now = () => new Date('2026-08-04T18:00:00.000Z');

  it('runQuoteMenuScan selects from_number (never id) from jc_sms_conversations', async () => {
    const sendSms = vi.fn(async () => ({ ok: true }));
    const { supabase, selects } = makeRecordingSupabase({
      jc_sms_conversations: [{ data: [{ from_number: '+18015551234' }] }],
      lead_postcall: [{ data: null }, { data: [] }],
    });
    await runQuoteMenuScan({
      sessionId: 's1', operatorPhone: '+18019414398', now,
      supabase: supabase as never, sendSms, withinWindow: true,
    });
    const convSelects = selects.filter((s) => s.table === 'jc_sms_conversations');
    expect(convSelects.length).toBeGreaterThan(0);
    expect(convSelects.map((s) => s.col)).toContain('from_number');
    expect(convSelects.map((s) => s.col)).not.toContain('id');
  });

  it('applyQuoteOutcome updates jc_sms_conversations by from_number (never id)', async () => {
    const { supabase, eqs } = makeRecordingSupabase({});
    await applyQuoteOutcome('1', null, { conversationId: '+18015551234', supabase: supabase as never, now });
    const convEqs = eqs.filter((e) => e.table === 'jc_sms_conversations');
    expect(convEqs.length).toBeGreaterThan(0);
    expect(convEqs.map((e) => e.col)).toContain('from_number');
    expect(convEqs.map((e) => e.col)).not.toContain('id');
  });
});
