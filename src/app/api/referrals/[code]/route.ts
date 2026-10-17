import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { refuseIfWritesDisabled } from '@/lib/supabase/write-gate';
import { unservedSessionResponse } from '@/lib/supabase/tenant-response';
import {
  captureReferralLead,
  countsTowardReferralCodeCap,
  isReferralCodeActive,
  normalizeReferralCode,
  validateReferralLeadInput,
  type ReferralCaptureRepository,
  type ReferralCode,
  type ReferralLeadInput,
  type ReferralLeadRow,
} from '@/lib/referrals/capture';
import { readReferralJsonBody } from '@/lib/referrals/request';

export const dynamic = 'force-dynamic';

type ServiceClient = ReturnType<typeof createServiceClient>;

async function findCode(service: ServiceClient, code: string): Promise<ReferralCode | null> {
  const { data } = await service.from('referral_codes')
    .select('code, session_id, referrer_name, referrer_email, referrer_phone, expires_at, revoked_at')
    .eq('code', code)
    .maybeSingle();
  return (data as ReferralCode | null) ?? null;
}

function repository(service: ServiceClient, knownCode: ReferralCode): ReferralCaptureRepository {
  return {
    findCode: async () => knownCode,
    async findDuplicateLead(input) {
      const queries = [];
      if (input.phone) {
        queries.push(service.from('client_leads').select('id').eq('session_id', input.sessionId).eq('phone', input.phone).limit(1));
      }
      if (input.email) {
        queries.push(service.from('client_leads').select('id').eq('session_id', input.sessionId).eq('email', input.email).limit(1));
      }
      const results = await Promise.all(queries);
      return results.map(result => result.data?.[0]).find(Boolean) as { id: string } | undefined ?? null;
    },
    async insertLead(lead: ReferralLeadRow) {
      const { data, error } = await service.from('client_leads').insert(lead).select('id').maybeSingle();
      if (error) throw error;
      // block_operator_as_lead() returns NULL to drop the row. Treat the
      // resulting empty insert as a clean refusal instead of a 500.
      if (!data) throw { code: 'operator_phone' };
      return data as { id?: string };
    },
  };
}

function genericSuccess() {
  return NextResponse.json({ ok: true }, { status: 201 });
}

export function referralCaptureResponse(result: Awaited<ReturnType<typeof captureReferralLead>>) {
  switch (result.kind) {
    // Deliberately identical: a caller must not learn whether a contact already
    // exists, whether the code owner used their own link, or which lead id won.
    case 'created':
    case 'duplicate':
    case 'self-referral':
    case 'operator-phone': return genericSuccess();
    case 'invalid-code': return NextResponse.json({ error: 'That referral link is invalid or expired.' }, { status: 404 });
    case 'invalid-input': return NextResponse.json({ error: `Please check the ${result.field}.`, field: result.field }, { status: 400 });
  }
}

function requestIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function hashIp(ip: string): string {
  const secret = process.env.REFERRAL_RATE_LIMIT_SALT || process.env.SUPABASE_SECRET_KEY || 'mate-referral-rate-limit';
  return createHmac('sha256', secret).update(ip).digest('hex');
}

async function recordAttempt(
  service: ServiceClient,
  referral: ReferralCode,
  ipHash: string,
  countForCode: boolean,
): Promise<NextResponse | null> {
  const { data, error } = await service.rpc('claim_referral_capture_attempt', {
    p_session_id: referral.session_id,
    p_referral_code: referral.code,
    p_ip_hash: ipHash,
    p_count_for_code: countForCode,
  });
  if (error || typeof data !== 'string') return NextResponse.json({ error: 'Referral capture is temporarily unavailable.' }, { status: 503 });
  if (data === 'code' || data === 'ip') return NextResponse.json({ error: 'Too many attempts. Try again tomorrow.' }, { status: 429 });
  if (data !== 'ok') return NextResponse.json({ error: 'Referral capture is temporarily unavailable.' }, { status: 503 });
  return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const writesOff = refuseIfWritesDisabled();
  if (writesOff) return writesOff;

  const { code: rawCode } = await params;
  const code = normalizeReferralCode(rawCode);
  if (!code) return referralCaptureResponse({ kind: 'invalid-code' });

  const service = createServiceClient();
  let referral: ReferralCode | null;
  try {
    referral = await findCode(service, code);
  } catch {
    return NextResponse.json({ error: 'Referral capture is temporarily unavailable.' }, { status: 503 });
  }
  if (!referral || !isReferralCodeActive(referral)) return referralCaptureResponse({ kind: 'invalid-code' });

  const unserved = unservedSessionResponse(request, referral.session_id);
  if (unserved) return unserved;

  const parsed = await readReferralJsonBody(request);
  if (!parsed.ok) {
    const limited = await recordAttempt(service, referral, hashIp(requestIp(request)), false);
    if (limited) return limited;
    return NextResponse.json(
      { error: parsed.reason === 'too-large' ? 'Request is too large.' : 'Please send a valid form.' },
      { status: parsed.reason === 'too-large' ? 413 : 400 },
    );
  }
  if (!parsed.value || typeof parsed.value !== 'object') {
    const limited = await recordAttempt(service, referral, hashIp(requestIp(request)), false);
    if (limited) return limited;
    return referralCaptureResponse({ kind: 'invalid-input', field: 'name' });
  }
  const body = parsed.value as ReferralLeadInput;

  // A hidden field catches basic bots without confirming whether the code or
  // any submitted contact is valid. It intentionally returns the same success.
  if (typeof body.website === 'string' && body.website.trim()) {
    const limited = await recordAttempt(service, referral, hashIp(requestIp(request)), false);
    if (limited) return limited;
    return genericSuccess();
  }

  const validation = validateReferralLeadInput(referral, body);
  const limited = await recordAttempt(
    service,
    referral,
    hashIp(requestIp(request)),
    countsTowardReferralCodeCap(validation),
  );
  if (limited) return limited;
  if (validation.kind === 'invalid-input') return referralCaptureResponse(validation);

  try {
    return referralCaptureResponse(await captureReferralLead(repository(service, referral), code, body));
  } catch {
    return NextResponse.json({ error: 'We could not save that referral. Please try again.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = normalizeReferralCode(rawCode);
  if (!code) return referralCaptureResponse({ kind: 'invalid-code' });
  const service = createServiceClient();
  try {
    const data = await findCode(service, code);
    if (!data || !isReferralCodeActive(data)) return referralCaptureResponse({ kind: 'invalid-code' });
    const unserved = unservedSessionResponse(request, data.session_id);
    if (unserved) return unserved;
    return NextResponse.json({ ok: true, referrer_name: data.referrer_name });
  } catch {
    return NextResponse.json({ error: 'Referral capture is temporarily unavailable.' }, { status: 503 });
  }
}

