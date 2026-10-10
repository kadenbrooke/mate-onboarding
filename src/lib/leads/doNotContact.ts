import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lead } from '@/lib/metrics/leads';
import { intakeTenantFor } from './intakeTenants';
import { practiceStatus } from '@/lib/portal/practice';
import { scanAll, type Query } from '@/lib/command/fetch';

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

const unavailableState = (): DoNotContactState => ({
  available: false, optedOut: true, source: 'unknown', recordedBy: null, recordedAt: null,
});

async function readLiveOptedOutPhones(
  client: SupabaseClient,
  tenant: NonNullable<ReturnType<typeof intakeTenantFor>>,
  candidatePhones: ReadonlySet<string>,
): Promise<OptedOutRead> {
  const scan = await scanAll<{ from_number?: unknown }>(() => client.from(tenant.conversationTable)
    // The live latch is the only lane state Mate needs. `eq(true)` deliberately
    // excludes null. The lane writes false on START and true on STOP/spoken
    // opt-out; a legacy null row is therefore not an active suppression state.
    // We intentionally read the table (not the lane view) here, so null cannot
    // be folded into a false-positive block without changing this contract.
    .select('from_number').eq('opted_out', true)
    // from_number is the lane's natural key, so this ordering makes scanAll's
    // shared pages deterministic even when the table is larger than 1,000 rows.
    .order('from_number', { ascending: true }) as unknown as Query<{ from_number?: unknown }>);
  if ('error' in scan || !scan.complete) {
    const error = 'error' in scan ? scan.error : undefined;
    console.error('[do-not-contact] opted-out read failed:', error?.code ?? '', error?.message ?? 'scan incomplete');
    return { available: false, phones: new Set() };
  }
  const optedOut = new Set<string>();
  for (const row of scan.rows) {
    const phone = typeof row.from_number === 'string' ? normalizeJcConsentPhone(row.from_number) : null;
    if (phone && candidatePhones.has(phone)) optedOut.add(phone);
  }
  return { available: true, phones: optedOut };
}

type PracticeRow = { id?: unknown; body?: unknown; created_at?: unknown };
type PracticeRead = {
  available: boolean;
  phones: Set<string>;
  receipts: Map<string, { recordedBy: string | null; recordedAt: string | null }>;
};

async function readPracticeLatch(client: SupabaseClient, sessionId: string): Promise<PracticeRead> {
  const scan = await scanAll<PracticeRow>(() => client.from('lead_messages')
    .select('id, body, created_at').eq('session_id', sessionId).eq('channel', 'call_note').eq('author', 'human')
    // lead_messages.id is unique; all pages therefore have a stable boundary.
    .order('id', { ascending: true }) as unknown as Query<PracticeRow>);
  if ('error' in scan || !scan.complete) {
    const error = 'error' in scan ? scan.error : undefined;
    console.error('[do-not-contact] practice opt-out read failed:', error?.code ?? '', error?.message ?? 'scan incomplete');
    return { available: false, phones: new Set(), receipts: new Map() };
  }
  const phones = new Set<string>();
  const receipts = new Map<string, { recordedBy: string | null; recordedAt: string | null }>();
  for (const row of scan.rows) {
    if (typeof row.body !== 'string' || !row.body.includes('[Practice fake] Do not contact')) continue;
    const recordedAt = typeof row.created_at === 'string' ? row.created_at : null;
    const recordedBy = row.body.match(/\brecorded_by=([^\s]+)/)?.[1] ?? null;
    for (const match of row.body.matchAll(/\bphone=([^\s]+)/g)) {
      const phone = normalizeJcConsentPhone(match[1]);
      if (!phone) continue;
      phones.add(phone);
      const previous = receipts.get(phone);
      if (!previous || !previous.recordedAt || (recordedAt && recordedAt >= previous.recordedAt)) {
        receipts.set(phone, { recordedBy, recordedAt });
      }
    }
  }
  return { available: true, phones, receipts };
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
    const practiceRead = await readPracticeLatch(client, sessionId);
    if (!practiceRead.available) return { available: false, phones: new Set() };
    const phones = new Set<string>();
    for (const lead of leads) {
      const normalized = normalizeJcConsentPhone(lead.phone);
      if (normalized && practiceRead.phones.has(normalized)) phones.add(normalized);
    }
    return { available: true, phones };
  }

  const phones = [...new Set(leads.map(lead => normalizeJcConsentPhone(lead.phone)).filter((p): p is string => !!p))];
  if (phones.length === 0) return { available: true, phones: new Set() };

  return readLiveOptedOutPhones(client, tenant, new Set(phones));
}

type OptOutOptions = { leadId?: string; isPractice?: boolean };

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
    // The latch is authoritative, but a receipt read failure must not invent
    // its source or a recorder. The UI still shows the suppression state and
    // can retry the receipt on refresh.
    return { available: true, optedOut: true, source: 'unknown', recordedBy: null, recordedAt: null };
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
  const tenant = intakeTenantFor(sessionId);
  if (!normalized) return tenant ? unavailableState() : { available: true, optedOut: false, source: null, recordedBy: null, recordedAt: null };
  let isPractice = options.isPractice;
  if (isPractice === undefined) {
    const practice = await practiceStatus(client, sessionId);
    if (!practice.ok) return unavailableState();
    isPractice = practice.isPractice;
  }
  if (isPractice) {
    const practiceRead = await readPracticeLatch(client, sessionId);
    if (!practiceRead.available) return unavailableState();
    const receipt = practiceRead.receipts.get(normalized);
    return receipt
      ? { available: true, optedOut: true, source: 'practice', ...receipt }
      : { available: true, optedOut: false, source: null, recordedBy: null, recordedAt: null };
  }
  return readLiveState(client, sessionId, normalized);
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
