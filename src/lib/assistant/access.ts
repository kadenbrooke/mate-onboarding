import { NextResponse } from 'next/server';
import { checkDashApiAccess } from '@/lib/portal/api-gate';

/** Assistant route authz on the shared dash access model: demo sessions are
 *  public; real sessions require a signed-in user who is a member of THIS
 *  session (portal_members) or internal (portal_access slug 'mate').
 *  Returns a NextResponse to return on denial, or null when access is allowed. */
export async function assertAssistantAccess(sessionId: string): Promise<NextResponse | null> {
  const verdict = await checkDashApiAccess(sessionId);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  return null;
}
