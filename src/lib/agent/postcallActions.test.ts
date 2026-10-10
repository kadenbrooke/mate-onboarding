import { describe, it, expect, vi } from 'vitest';
import { applyPostcallChoice } from './postcallActions';

function makeDeps(optedOut = false, readError = false, practiceFake = false) {
  const sends: Array<[string, string]> = [];
  const handlerUpdates: unknown[] = [];
  const logs: unknown[] = [];
  const practiceQuery = {
    eq: () => practiceQuery,
    order: () => ({ range: async () => ({ data: [{ id: 'fake', body: '[Practice fake] Do not contact phone=+18015551234', created_at: '2026-10-09T12:00:00.000Z' }], error: null }) }),
  };
  const supabase = {
    from: (t: string) => t === 'client_leads'
      ? { update: (v: unknown) => { handlerUpdates.push(v); return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }; } }
      : t === 'jc_sms_conversations'
        ? { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: readError ? null : optedOut ? [{ from_number: '+18015551234' }] : [], error: readError ? { message: 'read failed' } : null }) }) }) }) }
        : t === 'jc_consent_events'
          ? { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) }
          : t === 'lead_messages' && practiceFake
            ? { select: () => practiceQuery }
          : { insert: (v: unknown) => { logs.push(v); return Promise.resolve({ error: null }); } },
  };
  const sendSms = vi.fn(async (to: string, text: string) => { sends.push([to, text]); return { ok: true }; });
  return { sends, handlerUpdates, logs, supabase, sendSms };
}
const lead = { id: 'l1', session_id: 's1', phone: '+18015551234' };
const jcLead = { ...lead, session_id: '61400e73-0570-4167-88d9-d3a69650b15b' };
const config = { onboarding_form_url: 'https://form', faq_url: 'https://faq' };

describe('applyPostcallChoice', () => {
  it('1 sends the onboarding form and resumes agent', async () => {
    const d = makeDeps();
    await applyPostcallChoice('1', { lead, config, supabase: d.supabase as never, sendSms: d.sendSms as never });
    expect(d.sends[0][1]).toContain('https://form');
    expect(d.handlerUpdates[0]).toMatchObject({ handler: 'agent' });
  });
  it.each(['1', '2', '3'] as const)('refuses opted-out lead before choice %s sends', async choice => {
    const d = makeDeps(true);
    const result = await applyPostcallChoice(choice, { lead: jcLead, config, supabase: d.supabase as never, sendSms: d.sendSms as never });
    expect(result).toMatchObject({ status: 409 });
    expect(d.sends).toHaveLength(0);
  });
  it('refuses the send when opt-out status cannot be read', async () => {
    const d = makeDeps(false, true);
    const result = await applyPostcallChoice('2', { lead: jcLead, config, supabase: d.supabase as never, sendSms: d.sendSms as never });
    expect(result).toMatchObject({ status: 409 });
    expect(d.sends).toHaveLength(0);
  });
  it('refuses an unnormalizable J&C phone before any menu choice sends', async () => {
    const d = makeDeps();
    const result = await applyPostcallChoice('2', {
      lead: { ...jcLead, phone: '8010550001' }, config, supabase: d.supabase as never, sendSms: d.sendSms as never,
    });
    expect(result).toMatchObject({ status: 409, error: expect.stringContaining('valid J&C phone number') });
    expect(d.sends).toHaveLength(0);
  });
  it('uses the Mate fake latch for practice without reading the J&C table', async () => {
    const d = makeDeps(false, false, true);
    const result = await applyPostcallChoice('2', {
      lead: { ...lead, session_id: 'practice' }, config: { ...config, is_practice: true },
      supabase: d.supabase as never, sendSms: d.sendSms as never,
    });
    expect(result).toMatchObject({ status: 409 });
    expect(d.sends).toHaveLength(0);
  });
  it('2 resumes agent with a bridge text', async () => {
    const d = makeDeps();
    await applyPostcallChoice('2', { lead, config, supabase: d.supabase as never, sendSms: d.sendSms as never });
    expect(d.handlerUpdates[0]).toMatchObject({ handler: 'agent' });
    expect(d.sends.length).toBe(1);
  });
  it('3 sends the FAQ and resumes agent', async () => {
    const d = makeDeps();
    await applyPostcallChoice('3', { lead, config, supabase: d.supabase as never, sendSms: d.sendSms as never });
    expect(d.sends[0][1]).toContain('https://faq');
    expect(d.handlerUpdates[0]).toMatchObject({ handler: 'agent' });
  });
  it('4 sets handler=human and sends nothing', async () => {
    const d = makeDeps();
    await applyPostcallChoice('4', { lead, config, supabase: d.supabase as never, sendSms: d.sendSms as never });
    expect(d.handlerUpdates[0]).toMatchObject({ handler: 'human' });
    expect(d.sends.length).toBe(0);
  });
  it('3 with no faq_url skips the send but still resumes agent', async () => {
    const d = makeDeps();
    await applyPostcallChoice('3', { lead, config: { onboarding_form_url: 'https://form', faq_url: null }, supabase: d.supabase as never, sendSms: d.sendSms as never });
    expect(d.sends.length).toBe(0);
    expect(d.handlerUpdates[0]).toMatchObject({ handler: 'agent' });
  });
});
