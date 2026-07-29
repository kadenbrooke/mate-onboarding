import type { SupabaseClient } from '@supabase/supabase-js';

export type Handler = 'agent' | 'human';

/** Flip a lead's handler and stamp the audit fields. Scoped by lead id + session. */
export async function setHandler(
  client: SupabaseClient,
  opts: { leadId: string; sessionId: string; handler: Handler; by: string },
): Promise<{ error: string | null }> {
  const { error } = await client.from('client_leads')
    .update({ handler: opts.handler, handler_changed_at: new Date().toISOString(), handler_changed_by: opts.by })
    .eq('id', opts.leadId).eq('session_id', opts.sessionId);
  return { error: error ? error.message : null };
}
