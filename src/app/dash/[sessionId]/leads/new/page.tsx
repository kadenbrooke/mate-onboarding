import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { isLeadSnapshotLive } from '@/lib/leads/capability';
import { intakeTenantFor } from '@/lib/leads/intakeTenants';
import { BackLink } from '@/components/dash/chrome/BackLink';
import { MobileNav } from '@/components/dash/MobileNav';
import { SnapshotFlow } from '@/components/dash/leads/snapshot/SnapshotFlow';
import { FONT_HEAD, FONT_HEAD_FEATURE, TEXT_MUTED, FONT_BODY } from '@/lib/theme';

// /dash/<sessionId>/leads/new
//
// Lead Snapshot: photograph a note, confirm what it says, the First Responder
// texts the lead. Server half: gate, capability check, hand the client the
// tenant's opener copy so it can show exactly what will be sent.
//
// 404 rather than a "coming soon" page when the capability is not live. The
// pipeline page only links here when it IS live, so an unexpected visitor is
// someone typing URLs, and a feature that does not exist for them should look
// like it does not exist.

export const dynamic = 'force-dynamic';

export default async function NewLeadPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId: rawSessionId } = await params;
  const sessionId = resolveSessionId(rawSessionId);
  const access = await requireDashAccess(sessionId);
  if (access === 'demo') notFound();

  const supabase = createServiceClient();
  const { data: session } = await supabase
    .from('onboarding_sessions')
    .select('id, contact_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session?.contact_id) notFound();

  const { data: caps } = await supabase
    .from('client_capabilities')
    .select('capability_key, status')
    .eq('contact_id', session.contact_id as string);
  if (!isLeadSnapshotLive(caps)) notFound();

  const tenant = intakeTenantFor(sessionId);

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '12px 0' }}>
        <BackLink href={`/dash/${sessionId}/pipeline`} />
        <h1 style={{ fontSize: 18, margin: 0, fontFamily: FONT_HEAD, fontFeatureSettings: FONT_HEAD_FEATURE }}>
          Add a lead from a photo
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: TEXT_MUTED, fontFamily: FONT_BODY }}>
          Snap a note, a card, or a list. Check what it read, then we text them.
        </p>
      </div>
      <SnapshotFlow
        sessionId={sessionId}
        opener={tenant ? { agentName: tenant.agentName, businessName: tenant.businessName, optOutLine: tenant.optOutLine } : null}
      />
      <MobileNav sessionId={sessionId} />
    </div>
  );
}
