import { createServiceClient } from '@/lib/supabase/service';
import { notFound } from 'next/navigation';
import type { Lead } from '@/lib/metrics/leads';
import { LeadsTable } from '@/components/dash/leads/LeadsTable';
import { LeadThread } from '@/components/dash/leads/LeadThread';
import type { LeadMessage } from '@/lib/agent/messages';
import { BG_CARD, CARD_SHADOW } from '@/lib/theme';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { BackLink } from '@/components/dash/chrome/BackLink';
import { MobileNav } from '@/components/dash/MobileNav';

export default async function LeadsPage({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ spotlight?: string }>;
}) {
  const { sessionId: rawSessionId } = await params;
  // "demo" alias -> real demo UUID for all DB reads below (uuid column).
  const sessionId = resolveSessionId(rawSessionId);
  await requireDashAccess(sessionId);
  const { spotlight } = await searchParams;
  const supabase = createServiceClient();
  const { data: session } = await supabase.from('onboarding_sessions').select('id').eq('id', sessionId).single();
  if (!session) notFound();
  const { data: leads } = await supabase.from('client_leads')
    .select('*').eq('session_id', sessionId)
    .order('contacted', { ascending: true }).order('score', { ascending: false })
    .limit(500);

  let thread: { messages: LeadMessage[]; handler: 'agent' | 'human'; leadId: string } | null = null;
  if (spotlight) {
    const { data: lead } = await supabase.from('client_leads')
      .select('id, handler').eq('id', spotlight).eq('session_id', sessionId).single();
    if (lead) {
      const { data: messages } = await supabase.from('lead_messages')
        .select('*').eq('lead_id', spotlight).eq('session_id', sessionId).order('created_at', { ascending: true }).limit(200);
      thread = { messages: (messages ?? []) as LeadMessage[], handler: (lead.handler ?? 'agent') as 'agent' | 'human', leadId: lead.id };
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '12px 0' }}>
        <BackLink href={`/dash/${sessionId}`} />
        <h1 style={{ fontSize: 18, margin: 0 }}>Leads</h1>
      </div>
      {thread && (
        <div style={{ marginBottom: 12 }}>
          <LeadThread leadId={thread.leadId} sessionId={sessionId} handler={thread.handler} messages={thread.messages} />
        </div>
      )}
      <div style={{ background: BG_CARD, borderRadius: 16, padding: 8, boxShadow: CARD_SHADOW }}>
        <LeadsTable leads={(leads ?? []) as Lead[]} sessionId={sessionId} spotlightId={spotlight ?? null} />
      </div>
      <MobileNav sessionId={sessionId} />
    </div>
  );
}
