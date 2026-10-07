// Job outcome input rules (migration 0021), shared by the API route and the
// lead view so both sides agree on what a valid entry is. Pure.

export const JOB_OUTCOMES = ['won', 'lost'] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

/** $10,000,000. Anything above is a typo (an extra zero or two), not a job. */
export const MAX_JOB_CENTS = 1_000_000_000;
export const MAX_LOST_REASON = 200;

/** The columns one outcome write sets, all together. */
export type OutcomeValues = {
  job_outcome: JobOutcome | null;
  job_value_cents: number | null;
  lost_reason: string | null;
};

export type OutcomeParse =
  | { ok: true; values: OutcomeValues }
  | { ok: false; error: string };

const CLEARED: OutcomeValues = { job_outcome: null, job_value_cents: null, lost_reason: null };

function centsField(v: unknown, label: string): { ok: true; cents: number | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, cents: null };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_JOB_CENTS) {
    return { ok: false, error: `${label} must be whole cents between 0 and ${MAX_JOB_CENTS}` };
  }
  return { ok: true, cents: v };
}

/**
 * Validate a PATCH body: { outcome: 'won'|'lost'|null, job_value_cents?,
 * lost_reason? }. `outcome: null` clears every field. A sold price belongs
 * only to a won job and a reason only to a lost one, matching the 0021 CHECK
 * constraints, so a bad entry is a 400 here, not a 500 there. Cash collected
 * is not part of the outcome: it is entered payment by payment
 * (parsePaymentBody).
 */
export function parseOutcomeBody(body: unknown): OutcomeParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  if (!('outcome' in b)) return { ok: false, error: 'outcome is required (won, lost, or null to clear)' };
  if (b.outcome === null) return { ok: true, values: { ...CLEARED } };
  if (b.outcome !== 'won' && b.outcome !== 'lost') {
    return { ok: false, error: 'outcome must be won, lost, or null' };
  }

  if ('collected_cents' in b) {
    return { ok: false, error: 'cash collected is recorded as payments, not on the outcome' };
  }
  const value = centsField(b.job_value_cents, 'job_value_cents');
  if (!value.ok) return value;

  if (b.outcome === 'lost') {
    if (value.cents !== null) {
      return { ok: false, error: 'a lost job has no job value' };
    }
    let reason: string | null = null;
    if (b.lost_reason !== undefined && b.lost_reason !== null) {
      if (typeof b.lost_reason !== 'string') return { ok: false, error: 'lost_reason must be text' };
      reason = b.lost_reason.trim() || null;
      if (reason && reason.length > MAX_LOST_REASON) {
        return { ok: false, error: `lost_reason is limited to ${MAX_LOST_REASON} characters` };
      }
    }
    return { ok: true, values: { job_outcome: 'lost', job_value_cents: null, lost_reason: reason } };
  }

  if (b.lost_reason !== undefined && b.lost_reason !== null && b.lost_reason !== '') {
    return { ok: false, error: 'lost_reason only applies to a lost job' };
  }
  return { ok: true, values: { job_outcome: 'won', job_value_cents: value.cents, lost_reason: null } };
}

/** One payment write (client_lead_payments). Negative = refund / chargeback. */
export type PaymentValues = { amount_cents: number; paid_at: string };

export type PaymentParse =
  | { ok: true; values: PaymentValues }
  | { ok: false; error: string };

// Clock skew allowance for "today": the panel sends local noon for a past
// date and "now" for today, so anything past a day ahead is a mistyped date.
const FUTURE_SLACK_MS = 86_400_000;
const EARLIEST_PAYMENT = Date.UTC(2000, 0, 1);

/**
 * Validate a POST body: { amount_cents, paid_at? }. amount_cents is signed
 * whole cents, never 0 (a refund or chargeback is negative). paid_at is an
 * ISO timestamp for the day the money moved, not in the future; it defaults
 * to now. Matches the 0021 amount CHECK, so a bad entry is a 400.
 */
export function parsePaymentBody(body: unknown, now = new Date()): PaymentParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const a = b.amount_cents;
  if (typeof a !== 'number' || !Number.isInteger(a) || a === 0 || Math.abs(a) > MAX_JOB_CENTS) {
    return { ok: false, error: `amount_cents must be whole cents, not 0, at most ${MAX_JOB_CENTS} either way` };
  }
  let paidAt = now.toISOString();
  if (b.paid_at !== undefined && b.paid_at !== null) {
    const t = typeof b.paid_at === 'string' ? Date.parse(b.paid_at) : NaN;
    if (!Number.isFinite(t)) return { ok: false, error: 'paid_at must be an ISO date' };
    if (t > now.getTime() + FUTURE_SLACK_MS) return { ok: false, error: 'paid_at cannot be in the future' };
    if (t < EARLIEST_PAYMENT) return { ok: false, error: 'paid_at is too far in the past' };
    paidAt = new Date(t).toISOString();
  }
  return { ok: true, values: { amount_cents: a, paid_at: paidAt } };
}

/**
 * Parse what someone types into a money box ("4250", "$4,250.50", "4250.5")
 * into whole cents. Empty means "not entered" (null). Anything else that is
 * not a plain non-negative amount with at most two decimals is invalid.
 */
export function parseDollarsToCents(input: string): { ok: true; cents: number | null } | { ok: false } {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (s === '') return { ok: true, cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return { ok: false };
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_JOB_CENTS) return { ok: false };
  return { ok: true, cents };
}

/** Cents back to an editable dollar string: 425050 -> "4250.50", 425000 -> "4250". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac ? `${whole}.${String(frac).padStart(2, '0')}` : String(whole);
}
