import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { refuseIfWritesDisabled } from '@/lib/supabase/write-gate';
import { checkDashApiAccess } from '@/lib/portal/api-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { isUniqueViolation, normalizeEmail } from '@/lib/referrals/capture';
import { readReferralJsonBody } from '@/lib/referrals/request';
import { toE164 } from '@/lib/leads/phone';

export const dynamic = 'force-dynamic';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateReferralCode(): string {
  const bytes = randomBytes(10);
  return [...bytes].map(byte => ALPHABET[byte % ALPHABET.length]).join('');
}

function validName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name ? name.slice(0, 200) : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const writesOff = refuseIfWritesDisabled();
  if (writesOff) return writesOff;
  const { sessionId: raw } = await params;
  const sessionId = resolveSessionId(raw);
  const verdict = await checkDashApiAccess(sessionId);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  const parsed = await readReferralJsonBody(request);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === 'too-large' ? 'Request is too large.' : 'Please send a valid request.' }, { status: parsed.reason === 'too-large' ? 413 : 400 });
  if (!parsed.value || typeof parsed.value !== 'object') return NextResponse.json({ error: 'referrer_name is required' }, { status: 400 });
  const body = parsed.value as { referrer_name?: unknown; referrer_email?: unknown; referrer_phone?: unknown; expires_at?: unknown };

  const referrerName = validName(body.referrer_name);
  if (!referrerName) return NextResponse.json({ error: 'referrer_name is required' }, { status: 400 });
  const referrerEmail = body.referrer_email == null ? null : normalizeEmail(body.referrer_email);
  if (body.referrer_email != null && !referrerEmail) return NextResponse.json({ error: 'referrer_email is invalid' }, { status: 400 });
  const phoneInput = typeof body.referrer_phone === 'string' ? body.referrer_phone.trim() : '';
  const phoneResult = phoneInput ? toE164(phoneInput) : null;
  if (phoneInput && (!phoneResult || !phoneResult.ok)) return NextResponse.json({ error: 'referrer_phone is invalid' }, { status: 400 });

  let expiresAt: string | null = null;
  if (body.expires_at != null) {
    if (typeof body.expires_at !== 'string' || !Number.isFinite(Date.parse(body.expires_at)) || Date.parse(body.expires_at) <= Date.now()) {
      return NextResponse.json({ error: 'expires_at must be a future date' }, { status: 400 });
    }
    expiresAt = new Date(body.expires_at).toISOString();
  }

  const service = createServiceClient();
  const { data: session, error: sessionError } = await service
    .from('onboarding_sessions').select('id, is_demo').eq('id', sessionId).maybeSingle();
  if (sessionError) return NextResponse.json({ error: 'Could not create referral link.' }, { status: 503 });
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (session.is_demo) return NextResponse.json({ error: 'Referral links are not available on the demo dashboard.' }, { status: 400 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateReferralCode();
    const { data, error } = await service.from('referral_codes').insert({
      session_id: sessionId,
      code,
      referrer_name: referrerName,
      referrer_email: referrerEmail,
      referrer_phone: phoneResult?.ok ? phoneResult.e164 : null,
      expires_at: expiresAt,
    }).select('code, referrer_name, expires_at').single();
    if (!error && data) {
      return NextResponse.json({
        code: data.code,
        link: new URL(`/referral/${data.code}`, request.url).toString(),
        referrer_name: data.referrer_name,
        expires_at: data.expires_at,
      }, { status: 201 });
    }
    if (!isUniqueViolation(error)) return NextResponse.json({ error: 'Could not create referral link.' }, { status: 503 });
  }
  return NextResponse.json({ error: 'Could not create a unique referral link. Try again.' }, { status: 503 });
}

