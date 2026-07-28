import { createServiceClient } from '@/lib/supabase/service';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Lead } from '@/lib/metrics/leads';
import { LeadsTable } from '@/components/dash/leads/LeadsTable';
import { BG_CARD, CARD_SHADOW } from '@/lib/theme';

export default async function LeadsPage({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ spotlight?: string }>;
}) {
  const { sessionId } = await params;
  const { spotlight } = await searchParams;
  const supabase = createServiceClient();
  const { data: session } = await supabase.from('onboarding_sessions').select('id').eq('id', sessionId).single();
  if (!session) notFound();
  const { data: leads } = await supabase.from('client_leads')
    .select('*').eq('session_id', sessionId)
    .order('contacted', { ascending: true }).order('score', { ascending: false })
    .limit(500);
  return (
    <div>
      <Link href={`/dash/${sessionId}`} style={{ fontSize: 12, opacity: .7, color: 'inherit' }}>Back to dashboard</Link>
      <h1 style={{ fontSize: 18, margin: '12px 0' }}>Leads</h1>
      <div style={{ background: BG_CARD, borderRadius: 16, padding: 8, boxShadow: CARD_SHADOW }}>
        <LeadsTable leads={(leads ?? []) as Lead[]} sessionId={sessionId} spotlightId={spotlight ?? null} />
      </div>
    </div>
  );
}
