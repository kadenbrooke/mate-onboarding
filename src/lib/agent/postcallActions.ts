import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostcallChoice } from './postcall';
import { setHandler } from './handler';
import { logMessage } from './messages';
import { fakePracticeMessage } from '@/lib/portal/practice';

type Lead = { id: string; session_id: string; phone: string | null };
type Config = { onboarding_form_url?: string | null; faq_url?: string | null };
type Send = (to: string, text: string) => Promise<{ ok: boolean; practice?: boolean }>;

/** Run the side effects for a chosen menu option. */
export async function applyPostcallChoice(
  choice: PostcallChoice,
  deps: { lead: Lead; config: Config; supabase: SupabaseClient; sendSms: Send },
): Promise<void> {
  const { lead, config, supabase, sendSms } = deps;
  const resume = () => setHandler(supabase, { leadId: lead.id, sessionId: lead.session_id, handler: 'agent', by: 'postcall' });

  if (choice === '4') {
    await setHandler(supabase, { leadId: lead.id, sessionId: lead.session_id, handler: 'human', by: 'postcall' });
    await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'outbound', author: 'system', channel: 'system', body: 'Operator handling this lead.' });
    return;
  }
  if (choice === '1' && lead.phone && config.onboarding_form_url) {
    const text = `Here's our quick onboarding form: ${config.onboarding_form_url}`;
    const sent = await sendSms(lead.phone, text);
    await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'outbound', author: 'agent', body: sent.practice ? fakePracticeMessage(text) : text });
  }
  if (choice === '3' && lead.phone && config.faq_url) {
    const text = `A few common questions answered here: ${config.faq_url}`;
    const sent = await sendSms(lead.phone, text);
    await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'outbound', author: 'agent', body: sent.practice ? fakePracticeMessage(text) : text });
  }
  if (choice === '2' && lead.phone) {
    const text = 'Thanks for the call. This is our assistant now picking things back up. What else can I help with?';
    const sent = await sendSms(lead.phone, text);
    await logMessage(supabase, { leadId: lead.id, sessionId: lead.session_id, direction: 'outbound', author: 'agent', body: sent.practice ? fakePracticeMessage(text) : text });
  }
  await resume();
}
