import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lead } from '@/lib/metrics/leads';
import { intakeTenantFor } from './intakeTenants';
import { practiceStatus } from '@/lib/portal/practice';

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

export type DoNotContactSource = 'phone_call' | 'text_stop' | 'practice' | 'unknown' | null;

export type DoNotContactState = {
  available: boolean;
  optedOut: boolean;
  source: DoNotContactSource;
  recordedBy: string | null;
  recordedAt: string | null;
  warning?: string;
};

export const OPT_OUT_UNAVAILABLE_NOTICE = "Opt-out status couldn't be checked, so the call list is hidden. Refresh to retry.";

const OPT_OUT_PAGE_SIZE = 1000;
const unavailableState = (): DoNotContactState => ({
  available: false, optedOut: true, source: 'unknown', recordedBy: null, recordedAt: null,
});

async function readLiveOptedOutPhones(
  client: SupabaseClient,
  tenant: NonNullable<ReturnType<typeof intakeTenantFor>>,
  candidatePhones: ReadonlySet<string>,
): Promise<OptedOutRead> {
  const optedOut = new Set<string>();
  for (let page = 0; ; page++) {
    const from = page * OPT_OUT_PAGE_SIZE;
    const to = from + OPT_OUT_PAGE_SIZE - 1;
    const { data, error } = await client.from(tenant.conversationTable)
      // The live latch is the only lane state Mate needs. `eq(true)` deliberately
      // excludes null, which is not an active suppression state in the lane.
      .select('from_number').eq('opted_out', true).range(from, to);
    if (error || !data) {
      console.error('[do-not-contact] opted-out read failed:', error?.code ?? '', error?.message ?? 'no data');
      return { available: false, phones: new Set() };
    }
    for (const row of data as Array<{ from_number?: unknown }>) {
      const phone = typeof row.from_number === 'string' ? normalizeJcConsentPhone(row.from_number) : null;
      if (phone && candidatePhones.has(phone)) optedOut.add(phone);
    }
    if (data.length < OPT_OUT_PAGE_SIZE) break;
  }
  return { available: true, phones: optedOut };
}

/**
 * Read the lane's live suppression latch. A non-J&C tenant never touches the
 * J&C table. If the table is unavailable, callers fail closed for contact
 * prompts rather than risk showing a number Mate cannot prove is safe.
 */
export async function loadOptedOutPhones(
  client: SupabaseClient,
  sessionId: string,
  leads: Pick<Lead, 'id' | 'phone'>[],
): Promise<OptedOutRead> {
  const tenant = intakeTenantFor(sessionId);
  if (!tenant) {
    // Practice has a Mate-owned fake latch in lead_messages. It never reads
    // the live J&C tables, while other non-J&C tenants remain untouched.
    const practice = await practiceStatus(client, sessionId);
    if (!practice.ok || !practice.isPractice) return { available: true, phones: new Set() };
    const phones = new Set<string>();
    for (const lead of leads) {
      const normalized = normalizeJcConsentPhone(lead.phone);
      if (!normalized) continue;
      const state = await readPracticeState(client, sessionId, normalized, lead.id);
      if (!state.available) return { available: false, phones: new Set() };
      if (state.optedOut) phones.add(normalized);
    }
    return { available: true, phones };
  }

  const phones = [...new Set(leads.map(lead => normalizeJcConsentPhone(lead.phone)).filter((p): p is string => !!p))];
  if (phones.length === 0) return { available: true, phones: new Set() };

  return readLiveOptedOutPhones(client, tenant, new Set(phones));
}

type OptOutOptions = { leadId?: string; isPractice?: boolean };

async function readPracticeState(
  client: SupabaseClient,
  sessionId: string,
  phone: string,
  leadId?: string,
): Promise<DoNotContactState> {
  let query = client.from('lead_messages').select('body, created_at')
    .eq('session_id', sessionId).eq('channel', 'call_note').eq('author', 'human')
    .order('created_at', { ascending: false }).limit(100);
  if (leadId) query = query.eq('lead_id', leadId);
  const { data, error } = await query;
  if (error || !data) return unavailableState();
  const marker = `phone=${phone}`;
  const row = (data as Array<{ body?: unknown; created_at?: unknown }>).find(item =>
    typeof item.body === 'string' && item.body.includes('[Practice fake] Do not contact') && item.body.includes(marker));
  if (!row) return { available: true, optedOut: false, source: null, recordedBy: null, recordedAt: null };
  const body = row.body as string;
  const actor = body.match(/recorded_by=([^\s]+)/)?.[1] ?? null;
  return {
    available: true, optedOut: true, source: 'practice', recordedBy: actor,
    recordedAt: typeof row.created_at === 'string' ? row.created_at : null,
  };
}

async function readLiveState(
  client: SupabaseClient,
  sessionId: string,
  phone: string,
): Promise<DoNotContactState> {
  const tenant = intakeTenantFor(sessionId);
  if (!tenant) return { available: true, optedOut: false, source: null, recordedBy: null, recordedAt: null };
  const live = await readLiveOptedOutPhones(client, tenant, new Set([phone]));
  if (!live.available) return unavailableState();
  if (!live.phones.has(phone)) return { available: true, optedOut: false, source: null, recordedBy: null, recordedAt: null };

  const { data: event, error } = await client.from('jc_consent_events')
    .select('recorded_by, recorded_at, submitted_at').eq('from_number', phone)
    .eq('source', 'phone_call').order('submitted_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    // A live latch with no readable phone-call audit is the lane's existing
    // STOP state (the spoken RPC cannot exist without this audit table). Keep
    // that source visible rather than implying a Mate recording we cannot show.
    return { available: true, optedOut: true, source: 'text_stop', recordedBy: null, recordedAt: null };
  }
  if (event) {
    const recordedAt = typeof event.recorded_at === 'string' ? event.recorded_at
      : typeof event.submitted_at === 'string' ? event.submitted_at : null;
    return {
      available: true, optedOut: true, source: 'phone_call',
      recordedBy: typeof event.recorded_by === 'string' ? event.recorded_by : null, recordedAt,
    };
  }
  return { available: true, optedOut: true, source: 'text_stop', recordedBy: null, recordedAt: null };
}

/** Read one lead's current suppression state. A read error remains fail-closed. */
export async function readLeadOptOutState(
  client: SupabaseClient,
  sessionId: string,
  phone: string | null | undefined,
  options: OptOutOptions = {},
): Promise<DoNotContactState> {
  const normalized = normalizeJcConsentPhone(phone);
  if (!normalized) return { available: true, optedOut: false, source: null, recordedBy: null, recordedAt: null };
  let isPractice = options.isPractice;
  if (isPractice === undefined) {
    const practice = await practiceStatus(client, sessionId);
    if (!practice.ok) return unavailableState();
    isPractice = practice.isPractice;
  }
  return isPractice
    ? readPracticeState(client, sessionId, normalized, options.leadId)
    : readLiveState(client, sessionId, normalized);
}

/**
 * Shared outbound safety check. `true` includes an unreadable latch: callers
 * must refuse a send when they cannot prove the number is contactable.
 */
export async function isOptedOut(
  client: SupabaseClient,
  sessionId: string,
  phone: string | null | undefined,
  options: OptOutOptions = {},
): Promise<boolean> {
  try {
    const state = await readLeadOptOutState(client, sessionId, phone, options);
    return state.optedOut || !state.available;
  } catch (error) {
    console.error('[do-not-contact] outbound safety read failed:', error);
    return true;
  }
}
