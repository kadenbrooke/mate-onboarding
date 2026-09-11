import { createServiceClient } from '@/lib/supabase/service';
import { notFound } from 'next/navigation';
import type { Lead } from '@/lib/metrics/leads';
import { LeadsTable } from '@/components/dash/leads/LeadsTable';
import { LeadThread } from '@/components/dash/leads/LeadThread';
import { leadLabel } from '@/components/dash/leads/leadName';
import { parseSortParam } from '@/components/dash/leads/leadsControls';
import type { LeadMessage } from '@/lib/agent/messages';
import Link from 'next/link';
// /dist/ssr: this is a Server Component (see BackLink for why the default
// import throws here).
import { Camera } from '@phosphor-icons/react/dist/ssr';
import { BG_CARD, CARD_SHADOW, TEXT_DARK, FONT_BODY } from '@/lib/theme';
import { isLeadSnapshotLive } from '@/lib/leads/capability';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { BackLink } from '@/components/dash/chrome/BackLink';
import { MobileNav } from '@/components/dash/MobileNav';

export default async function PipelinePage({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ spotlight?: string; sort?: string; dir?: string }>;
}) {
  const { sessionId: rawSessionId } = await params;
  // "demo" alias -> real demo UUID for all DB reads below (uuid column).
  const sessionId = resolveSessionId(rawSessionId);
  await requireDashAccess(sessionId);
  const { spotlight, sort, dir } = await searchParams;
  // ?sort=captured (&dir=) deep-links a specific order; the NEW LEADS glance
  // tile on the dashboard lands here with newest-captured first.
  const initialSort = parseSortParam(sort, dir);
  const supabase = createServiceClient();
  const { data: session } = await supabase.from('onboarding_sessions').select('id, contact_id').eq('id', sessionId).single();
  if (!session) notFound();
  // Lead Snapshot (DEL-38) is capability gated per client; the "Add lead"
  // action only exists for a client whose row is live. client_capabilities is
  // anchored on contact_id, not session_id.
  const { data: caps } = session.contact_id
    ? await supabase.from('client_capabilities').select('capability_key, status').eq('contact_id', session.contact_id as string)
    : { data: [] };
  const canAddLead = isLeadSnapshotLive(caps);
  // is_test: reseller/founder demo rows never appear in the client's pipeline
  // (migration 032; generated from phone, so it cannot be forgotten by a writer).
  const { data: leads } = await supabase.from('client_leads')
    .select('*').eq('session_id', sessionId)
    .eq('is_test', false)
    .order('contacted', { ascending: true }).order('score', { ascending: false })
    .limit(500);

  let thread: {
    messages: LeadMessage[]; handler: 'agent' | 'human'; leadId: string; leadName: string | null;
  } | null = null;
  if (spotlight) {
    // phone + source come along so a nameless lead's thread header can fall back
    // to its number instead of reading "this lead" (see leadName.ts).
    const { data: lead } = await supabase.from('client_leads')
      .select('id, handler, name, phone, source').eq('id', spotlight).eq('session_id', sessionId).single();
    if (lead) {
      const { data: messages } = await supabase.from('lead_messages')
        .select('*').eq('lead_id', spotlight).eq('session_id', sessionId).order('created_at', { ascending: true }).limit(200);
      thread = {
        messages: (messages ?? []) as LeadMessage[],
        handler: (lead.handler ?? 'agent') as 'agent' | 'human',
        leadId: lead.id,
        leadName: leadLabel(lead),
      };
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '12px 0' }}>
        <BackLink href={`/dash/${sessionId}`} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Pipeline</h1>
          {canAddLead && (
            <Link href={`/dash/${sessionId}/leads/new`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10,
              background: TEXT_DARK, color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: FONT_BODY, textDecoration: 'none',
            }}>
              <Camera size={16} weight="bold" aria-hidden /> Add lead
            </Link>
          )}
        </div>
      </div>
      {thread && (
        <div style={{ marginBottom: 12 }}>
          <LeadThread
            leadId={thread.leadId}
            sessionId={sessionId}
            handler={thread.handler}
            messages={thread.messages}
            leadName={thread.leadName}
          />
        </div>
      )}
      <div style={{ background: BG_CARD, borderRadius: 16, padding: 8, boxShadow: CARD_SHADOW }}>
        <LeadsTable
          leads={(leads ?? []) as Lead[]}
          sessionId={sessionId}
          spotlightId={spotlight ?? null}
          initialSort={initialSort}
        />
      </div>
      <MobileNav sessionId={sessionId} />
    </div>
  );
}
