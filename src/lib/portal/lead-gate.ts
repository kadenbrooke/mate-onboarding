// Per-lead API gate. Every /api/leads/[id]/* mutation goes through this.
//
// The tenant comes from the lead row itself, read server-side with the service
// client. A session_id in the request body is NOT the tenant: it is only
// cross-checked, and a mismatch is reported as "not found" so one tenant cannot
// probe another tenant's lead ids. Access to that tenant is then decided by the
// shared dash access model (checkDashApiAccess: portal_members membership,
// internal portal_access slug 'mate', demo sessions public).
//
// Only the tenant identity is read before authorization. Anything else on the
// lead (phone, etc.) is the caller's to fetch AFTER the gate passes.
import { createServiceClient } from '@/lib/supabase/service';
import { checkDashApiAccess } from './api-gate';
import type { DashAccess } from './dash-access';

export type LeadRow = { id: string; session_id: string };

export type LeadApiVerdict =
  | { ok: true; lead: LeadRow; access: DashAccess }
  | { ok: false; status: number; error: string };

export async function checkLeadApiAccess(
  leadId: string,
  claimedSessionId?: string | null,
): Promise<LeadApiVerdict> {
  const { data: lead, error } = await createServiceClient()
    .from('client_leads')
    .select('id, session_id')
    .eq('id', leadId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!lead) return { ok: false, status: 404, error: 'lead not found' };

  const verdict = await checkDashApiAccess(lead.session_id);
  if (!verdict.ok) return verdict;

  if (claimedSessionId && claimedSessionId !== lead.session_id) {
    return { ok: false, status: 404, error: 'lead not found' };
  }
  return { ok: true, lead: lead as LeadRow, access: verdict.access };
}
