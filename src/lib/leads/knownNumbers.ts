// What this session already knows about a set of phone numbers.
//
// Shared by the extraction route (so the confirm screen can mark duplicates
// before the human spends time editing them) and the confirm route (so the
// decision is re-made at send time against fresh data, never trusted from the
// client). Both hand the result to planConfirm.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { KnownNumbers } from './confirmPlan';
import { leadKeyFromPhone } from './phone';
import type { IntakeTenant } from './intakeTenants';

export type KnownLead = { id: string; phone: string; name: string | null };

export async function loadKnownNumbers(
  service: SupabaseClient,
  sessionId: string,
  tenant: IntakeTenant | null,
  candidateE164: string[],
): Promise<KnownNumbers & { leadsByKey: Map<string, KnownLead> }> {
  const [{ data: leadRows }, { data: convoRows }] = await Promise.all([
    service.from('client_leads').select('id, phone, name').eq('session_id', sessionId).not('phone', 'is', null),
    tenant && candidateE164.length > 0
      ? service.from(tenant.conversationTable).select('from_number, last_outbound_at').in('from_number', candidateE164)
      : Promise.resolve({ data: [] as { from_number: string; last_outbound_at: string | null }[] }),
  ]);

  const leadKeys = new Set<string>();
  const leadsByKey = new Map<string, KnownLead>();
  for (const r of (leadRows ?? []) as KnownLead[]) {
    const k = leadKeyFromPhone(r.phone);
    if (!k) continue;
    leadKeys.add(k);
    if (!leadsByKey.has(k)) leadsByKey.set(k, r);
  }

  const conversations = new Map<string, { lastOutboundAt: string | null }>();
  for (const c of (convoRows ?? []) as { from_number: string; last_outbound_at: string | null }[]) {
    conversations.set(c.from_number, { lastOutboundAt: c.last_outbound_at });
  }

  return { leadKeys, conversations, leadsByKey };
}

/** The client's own numbers, which a photo must never text. */
export function ownNumbers(tenant: IntakeTenant | null, operatorPhone: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const n of [tenant?.smsFrom, operatorPhone]) {
    const k = leadKeyFromPhone(n);
    if (k) out.add(k);
  }
  return out;
}
