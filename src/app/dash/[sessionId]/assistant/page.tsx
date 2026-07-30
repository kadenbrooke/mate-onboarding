import { requireDashAccess } from '@/lib/portal/dash-gate';
import { AssistantView } from '@/components/dash/assistant/AssistantView';

export default async function AssistantPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  await requireDashAccess(sessionId);
  return (
    <div>
      <h1 style={{ fontSize: 18, margin: '12px 0' }}>Assistant</h1>
      <AssistantView sessionId={sessionId} />
    </div>
  );
}
