import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/** Assistant route authz, mirroring the leads/status route: demo sessions are
 *  public; real sessions require a signed-in user. Returns a NextResponse to
 *  return on denial, or null when access is allowed. */
export async function assertAssistantAccess(sessionId: string): Promise<NextResponse | null> {
  const service = createServiceClient();
  const { data: session } = await service
    .from('onboarding_sessions').select('is_demo').eq('id', sessionId).maybeSingle();
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!session.is_demo) {
    const ssr = await createClient();
    const { data: { user } } = await ssr.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }
  return null;
}
