import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { refuseIfWritesDisabled } from '@/lib/supabase/write-gate';
import {
  captureReferralLead,
  normalizeReferralCode,
  isReferralCodeActive,
  type ReferralCode,
  type ReferralLeadInput,
} from '@/lib/referrals/capture';

export const dynamic = 'force-dynamic';

function repository() {
  const service = createServiceClient();
  return {
    async findCode(code: string): Promise<ReferralCode | null> {
      const { data } = await service.from('referral_codes')
        .select('code, session_id, referrer_name, referrer_email, referrer_phone, expires_at, revoked_at')
        .eq('code', code)
        .maybeSingle();
      return (data as ReferralCode | null) ?? null;
    },
    async findDuplicateLead(input: { sessionId: string; phone: string | null; email: string | null }) {
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
    async insertLead(lead: Parameters<NonNullable<Parameters<typeof captureReferralLead>[0]['insertLead']>>[0]) {
      const { data, error } = await service.from('client_leads').insert(lead).select('id').single();
      if (error) throw error;
      return (data as { id?: string } | null) ?? {};
    },
  };
}

function responseFor(result: Awaited<ReturnType<typeof captureReferralLead>>) {
  switch (result.kind) {
    case 'created': return NextResponse.json({ ok: true, lead_id: result.lead.id }, { status: 201 });
    case 'duplicate': return NextResponse.json({ error: 'This contact has already been referred.', lead_id: result.leadId }, { status: 409 });
    case 'self-referral': return NextResponse.json({ error: 'You cannot use your own referral link.' }, { status: 400 });
    case 'invalid-code': return NextResponse.json({ error: 'That referral link is invalid or expired.' }, { status: 404 });
    case 'invalid-input': return NextResponse.json({ error: `Please check the ${result.field}.`, field: result.field }, { status: 400 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const writesOff = refuseIfWritesDisabled();
  if (writesOff) return writesOff;

  const { code: rawCode } = await params;
  const code = normalizeReferralCode(rawCode);
  if (!code) return responseFor({ kind: 'invalid-code' });

  let body: ReferralLeadInput;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object') return responseFor({ kind: 'invalid-input', field: 'name' });
    body = parsed as ReferralLeadInput;
  } catch {
    return NextResponse.json({ error: 'Please send a valid form.' }, { status: 400 });
  }

  try {
    return responseFor(await captureReferralLead(repository(), code, body));
  } catch {
    return NextResponse.json({ error: 'We could not save that referral. Please try again.' }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = normalizeReferralCode(rawCode);
  if (!code) return responseFor({ kind: 'invalid-code' });
  const service = createServiceClient();
  const { data } = await service.from('referral_codes')
    .select('code, referrer_name, expires_at, revoked_at')
    .eq('code', code)
    .maybeSingle();
  if (!data || !isReferralCodeActive(data)) {
    return responseFor({ kind: 'invalid-code' });
  }
  return NextResponse.json({ ok: true, referrer_name: data.referrer_name });
}

