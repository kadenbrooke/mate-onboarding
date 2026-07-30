import { describe, it, expect, vi } from 'vitest';
import { applyPostcallChoice } from './postcallActions';

function makeDeps() {
  const sends: Array<[string, string]> = [];
  const handlerUpdates: unknown[] = [];
  const logs: unknown[] = [];
  const supabase = {
    from: (t: string) => t === 'client_leads'
      ? { update: (v: unknown) => { handlerUpdates.push(v); return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }; } }
      : { insert: (v: unknown) => { logs.push(v); return Promise.resolve({ error: null }); } },
  };
  const sendSms = vi.fn(async (to: string, text: string) => { sends.push([to, text]); return { ok: true }; });
  return { sends, handlerUpdates, logs, supabase, sendSms };
}
const lead = { id: 'l1', session_id: 's1', phone: '+18015551234' };
const config = { onboarding_form_url: 'https://form', faq_url: 'https://faq' };

describe('applyPostcallChoice', () => {
  it('1 sends the onboarding form and resumes agent', async () => {
    const d = makeDeps();
    await applyPostcallChoice('1', { lead, config, supabase: d.supabase as never, sendSms: d.sendSms as never });
    expect(d.sends[0][1]).toContain('https://form');
    expect(d.handlerUpdates[0]).toMatchObject({ handler: 'agent' });
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
