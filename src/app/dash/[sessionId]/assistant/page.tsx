import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { AssistantView } from '@/components/dash/assistant/AssistantView';
import { BackLink } from '@/components/dash/chrome/BackLink';
import { MobileNav } from '@/components/dash/MobileNav';

export default async function AssistantPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId: rawSessionId } = await params;
  // "demo" alias -> real demo UUID (AssistantView queries by this id).
  const sessionId = resolveSessionId(rawSessionId);
  await requireDashAccess(sessionId);
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '12px 0' }}>
        <BackLink href={`/dash/${sessionId}`} />
        <h1 style={{ fontSize: 18, margin: 0 }}>Assistant</h1>
      </div>
      <AssistantView sessionId={sessionId} />
      <MobileNav sessionId={sessionId} />
    </div>
  );
}
