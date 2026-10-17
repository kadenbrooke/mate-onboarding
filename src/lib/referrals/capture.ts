import { toE164 } from '@/lib/leads/phone';

export const REFERRAL_CODE_LENGTH = 10;

export type ReferralCode = {
  code: string;
  session_id: string;
  referrer_name: string;
  referrer_email: string | null;
  referrer_phone: string | null;
  expires_at: string | null;
  revoked_at?: string | null;
};

export type ReferralLeadInput = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  website?: unknown;
  city?: unknown;
  service?: unknown;
  address?: unknown;
};

export type ReferralLeadRow = {
  session_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  service: string | null;
  address: string | null;
  source: 'referral';
  referrer_name: string;
  referral_code: string;
  status: 'open';
  contacted: false;
  after_hours: false;
};

export type ReferralCaptureResult =
  | { kind: 'created'; lead: ReferralLeadRow & { id?: string } }
  | { kind: 'duplicate'; leadId: string | null }
  | { kind: 'invalid-code' }
  | { kind: 'self-referral' }
  | { kind: 'operator-phone' }
  | { kind: 'invalid-input'; field: 'name' | 'contact' | 'phone' | 'email' };

export type ReferralCaptureRepository = {
  findCode: (code: string) => Promise<ReferralCode | null>;
  findDuplicateLead: (input: { sessionId: string; phone: string | null; email: string | null }) => Promise<{ id: string } | null>;
  insertLead: (lead: ReferralLeadRow) => Promise<{ id?: string }>;
};

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{8,32}$/.test(code) ? code : null;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

export function isReferralCodeActive(code: Pick<ReferralCode, 'expires_at' | 'revoked_at'>): boolean {
  if (code.revoked_at) return false;
  if (!code.expires_at) return true;
  const expires = Date.parse(code.expires_at);
  return Number.isFinite(expires) && expires > Date.now();
}

function sameIdentity(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && left === right;
}

type ValidatedReferralInput = {
  kind: 'valid';
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  service: string | null;
  address: string | null;
};

export type ReferralInputValidation =
  | ValidatedReferralInput
  | { kind: 'self-referral' }
  | { kind: 'invalid-input'; field: 'name' | 'contact' | 'phone' | 'email' };

export function countsTowardReferralCodeCap(validation: ReferralInputValidation): boolean {
  return validation.kind !== 'invalid-input';
}

export function validateReferralLeadInput(referral: ReferralCode, input: ReferralLeadInput): ReferralInputValidation {
  const name = text(input.name);
  if (!name) return { kind: 'invalid-input', field: 'name' };

  const rawPhone = text(input.phone);
  const phoneResult = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && (!phoneResult || !phoneResult.ok)) return { kind: 'invalid-input', field: 'phone' };
  const phone = phoneResult?.ok ? phoneResult.e164 : null;
  const email = normalizeEmail(input.email);
  if (input.email != null && text(input.email) && !email) return { kind: 'invalid-input', field: 'email' };
  if (!phone && !email) return { kind: 'invalid-input', field: 'contact' };

  const referrerEmail = normalizeEmail(referral.referrer_email);
  const referrerPhoneResult = referral.referrer_phone ? toE164(referral.referrer_phone) : null;
  const referrerPhone = referrerPhoneResult?.ok ? referrerPhoneResult.e164 : null;
  if (sameIdentity(email, referrerEmail) || sameIdentity(phone, referrerPhone)) {
    return { kind: 'self-referral' };
  }

  return {
    kind: 'valid', name, phone, email,
    city: text(input.city), service: text(input.service), address: text(input.address),
  };
}

export async function captureReferralLead(
  repository: ReferralCaptureRepository,
  rawCode: unknown,
  input: ReferralLeadInput,
): Promise<ReferralCaptureResult> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return { kind: 'invalid-code' };

  const referral = await repository.findCode(code);
  if (!referral || !isReferralCodeActive(referral)) return { kind: 'invalid-code' };

  const validation = validateReferralLeadInput(referral, input);
  if (validation.kind !== 'valid') return validation;
  const { name, phone, email, city, service, address } = validation;

  const duplicate = await repository.findDuplicateLead({ sessionId: referral.session_id, phone, email });
  if (duplicate) return { kind: 'duplicate', leadId: duplicate.id };

  const lead: ReferralLeadRow = {
    session_id: referral.session_id,
    name,
    phone,
    email,
    city,
    service,
    address,
    source: 'referral',
    referrer_name: referral.referrer_name,
    referral_code: referral.code,
    status: 'open',
    contacted: false,
    after_hours: false,
  };

  try {
    const inserted = await repository.insertLead(lead);
    return { kind: 'created', lead: { ...lead, ...inserted } };
  } catch (error) {
    // A database uniqueness constraint, when present in the deployed schema,
    // is the final race-safe duplicate guard. Re-read after a concurrent
    // capture wins instead of turning a legitimate repeat into a 500.
    if (isOperatorPhoneRejection(error)) return { kind: 'operator-phone' };
    if (isUniqueViolation(error)) {
      const raced = await repository.findDuplicateLead({ sessionId: referral.session_id, phone, email });
      return { kind: 'duplicate', leadId: raced?.id ?? null };
    }
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505';
}

export function isOperatorPhoneRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === 'operator_phone'
    || (value.code === 'PGRST116' && typeof value.message === 'string' && /no rows/i.test(value.message));
}

