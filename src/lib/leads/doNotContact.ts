import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lead } from '@/lib/metrics/leads';
import { intakeTenantFor } from './intakeTenants';

/** The exact US-NANP normalizer used by jc_consent__normalize_phone(). */
export function normalizeJcConsentPhone(raw: string | null | undefined): string | null {
  if (!raw || /[a-z<>]/i.test(raw)) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

export function filterOptedOutLeads<T extends Lead>(leads: T[], optedOutPhones: ReadonlySet<string>): T[] {
  return leads.filter(lead => {
    const phone = normalizeJcConsentPhone(lead.phone);
    return !phone || !optedOutPhones.has(phone);
  });
}

export type OptedOutRead = {
  available: boolean;
  phones: Set<string>;
};

/**
 * Read the lane's live suppression latch. A non-J&C tenant never touches the
 * J&C table. If the table is unavailable, callers fail closed for contact
 * prompts rather than risk showing a number Mate cannot prove is safe.
 */
export async function loadOptedOutPhones(
  client: SupabaseClient,
  sessionId: string,
  leads: Pick<Lead, 'phone'>[],
): Promise<OptedOutRead> {
  const tenant = intakeTenantFor(sessionId);
  if (!tenant) return { available: true, phones: new Set() };

  const phones = [...new Set(leads.map(lead => normalizeJcConsentPhone(lead.phone)).filter((p): p is string => !!p))];
  if (phones.length === 0) return { available: true, phones: new Set() };

  const { data, error } = await client.from(tenant.conversationTable)
    .select('from_number, opted_out').in('from_number', phones);
  if (error || !data) {
    console.error('[do-not-contact] opted-out read failed:', error?.code ?? '', error?.message ?? 'no data');
    return { available: false, phones: new Set() };
  }

  const optedOut = new Set<string>();
  for (const row of data as Array<{ from_number?: unknown; opted_out?: unknown }>) {
    const phone = typeof row.from_number === 'string' ? normalizeJcConsentPhone(row.from_number) : null;
    if (phone && row.opted_out === true) optedOut.add(phone);
  }
  return { available: true, phones: optedOut };
}
