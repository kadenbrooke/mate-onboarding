import { createServiceClient } from '@/lib/supabase/service';
import { isReferralCodeActive, normalizeReferralCode } from '@/lib/referrals/capture';
import { ReferralCaptureForm } from './ReferralCaptureForm';

export const dynamic = 'force-dynamic';

export default async function ReferralPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = normalizeReferralCode(rawCode);
  const service = createServiceClient();
  const { data } = code
    ? await service.from('referral_codes').select('code, referrer_name, expires_at, revoked_at').eq('code', code).maybeSingle()
    : { data: null };
  const valid = !!data && isReferralCodeActive(data);

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>{valid ? 'Tell us how to reach you' : 'Referral link unavailable'}</h1>
      {valid && code ? <ReferralCaptureForm code={code} referrerName={data.referrer_name} /> : <p>This referral link is invalid or expired.</p>}
    </main>
  );
}

