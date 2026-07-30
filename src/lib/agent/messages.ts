import type { SupabaseClient } from '@supabase/supabase-js';

export type LeadMessage = {
  id: string; lead_id: string; session_id: string;
  direction: 'inbound' | 'outbound';
  author: 'lead' | 'agent' | 'human' | 'system';
  channel: 'sms' | 'call_note' | 'system';
  body: string; created_at: string;
};

export async function logMessage(
  client: SupabaseClient,
  m: {
    leadId: string; sessionId: string;
    direction: 'inbound' | 'outbound';
    author: 'lead' | 'agent' | 'human' | 'system';
    body: string; channel?: 'sms' | 'call_note' | 'system';
  },
): Promise<{ error: string | null }> {
  const { error } = await client.from('lead_messages').insert({
    lead_id: m.leadId, session_id: m.sessionId,
    direction: m.direction, author: m.author, channel: m.channel ?? 'sms', body: m.body,
  });
  return { error: error ? error.message : null };
}
