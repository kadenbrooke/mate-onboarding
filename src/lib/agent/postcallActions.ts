import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostcallChoice } from './postcall';
import { setHandler } from './handler';
import { logMessage } from './messages';
import { fakePracticeMessage } from '@/lib/portal/practice';
import { intakeTenantFor } from '@/lib/leads/intakeTenants';
import { normalizeJcConsentPhone, readLeadOptOutState } from '@/lib/leads/doNotContact';

type Lead = { id: string; session_id: string; phone: string | null };
type Config = { onboarding_form_url?: string | null; faq_url?: string | null; is_practice?: boolean; operator_phone?: string | null };
type Send = (to: string, text: string) => Promise<{ ok: boolean; practice?: boolean }>;
export type PostcallBlockReason = 'opted_out' | 'invalid_phone' | 'opt_out_unavailable';
export type PostcallActionResult = { ok: true } | { ok: false; status: 409; reason: PostcallBlockReason; error: string };

/** Run the side effects for a chosen menu option. */
export async function applyPostcallChoice(
  choice: PostcallChoice,
  deps: { lead: Lead; config: Config; supabase: SupabaseClient; sendSms: Send },
): Promise<PostcallActionResult> {
  const { lead, config, supabase, sendSms } = deps;
  const resume = () => setHandler(supabase, { leadId: lead.id, sessionId: lead.session_id, handler: 'agent', by: 'postcall' });
  const refuseIfBlocked = async (): Promise<PostcallActionResult | null> => {
    if (intakeTenantFor(lead.session_id) && !normalizeJcConsentPhone(lead.phone)) {
      return {
        ok: false, status: 409, reason: 'invalid_phone',
        error: 'This lead has no valid J&C phone number; sending is blocked.',
      };
    }
    let state;
    try {
      state = await readLeadOptOutState(supabase, lead.session_id, lead.phone, { leadId: lead.id, isPractice: config.is_practice === true });
    } catch (error) {
      console.error('[postcall] opt-out read failed:', error);
      return {
        ok: false, status: 409, reason: 'opt_out_unavailable',
        error: "Opt-out status couldn't be checked; sending is blocked. Reply again to retry.",
      };
    }
    if (!state.optedOut && state.available) return null;
    if (!state.available) {
      return {
        ok: false, status: 409, reason: 'opt_out_unavailable',
        error: "Opt-out status couldn't be checked; sending is blocked. Reply again to retry.",
      };
    }
    return {
      ok: false, status: 409, reason: 'opted_out',
      error: "This lead asked not to be contacted, or opt-out status couldn't be checked; sending is blocked. Refresh to retry.",
    };
  };

  if (choice === '4') {
    await setHandler(supabase, { leadId: lead.id, sessionId: lead.session_id, handler: 'human', by: 'postcall' });
    await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'outbound', author: 'system', channel: 'system', body: 'Operator handling this lead.' });
    return { ok: true };
  }
  if (choice === '1' && lead.phone && config.onboarding_form_url) {
    const blocked = await refuseIfBlocked();
    if (blocked) return blocked;
    const text = `Here's our quick onboarding form: ${config.onboarding_form_url}`;
    const sent = await sendSms(lead.phone, text);
    await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'outbound', author: 'agent', body: sent.practice ? fakePracticeMessage(text) : text });
  }
  if (choice === '3' && lead.phone && config.faq_url) {
    const blocked = await refuseIfBlocked();
    if (blocked) return blocked;
    const text = `A few common questions answered here: ${config.faq_url}`;
    const sent = await sendSms(lead.phone, text);
    await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'outbound', author: 'agent', body: sent.practice ? fakePracticeMessage(text) : text });
  }
  if (choice === '2' && lead.phone) {
    const blocked = await refuseIfBlocked();
    if (blocked) return blocked;
    const text = 'Thanks for the call. This is our assistant now picking things back up. What else can I help with?';
    const sent = await sendSms(lead.phone, text);
    await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'outbound', author: 'agent', body: sent.practice ? fakePracticeMessage(text) : text });
  }
  await resume();
  return { ok: true };
}
