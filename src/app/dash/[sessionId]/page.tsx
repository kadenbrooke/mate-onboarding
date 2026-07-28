import { createServiceClient } from '@/lib/supabase/service';
import { notFound } from 'next/navigation';
import type { Lead } from '@/lib/metrics/leads';
import { DashboardView } from '@/components/dash/DashboardView';

export default async function DashPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const supabase = createServiceClient();
  const { data: session } = await supabase
    .from('onboarding_sessions')
    .select('id, mate_name')
    .eq('id', sessionId)
    .single();
  if (!session) notFound();
  const { data: leads } = await supabase
    .from('client_leads')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(500);
  return <DashboardView session={session} leads={(leads ?? []) as Lead[]} />;
}
