// API-route twin of dash-gate. Same access model (portal_members membership or
// internal portal_access, demo sessions open), but it RETURNS a verdict instead
// of calling notFound()/redirect(), which are page-only primitives.
//
// Destructive mutations must use this rather than "the caller knew the session
// UUID", which is not authorization: session ids appear in every dashboard URL.
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveDashAccess, type DashAccess } from './dash-access';

export type DashApiVerdict =
  | { ok: true; access: DashAccess }
  | { ok: false; status: number; error: string };

export async function checkDashApiAccess(sessionId: string): Promise<DashApiVerdict> {
  const service = createServiceClient();
  const { data: session } = await service
    .from('onboarding_sessions')
    .select('id, is_demo')
    .eq('id', sessionId)
    .maybeSingle();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isMember = false;
  let isInternal = false;
  if (user && session && !session.is_demo) {
    const [memberRes, internalRes] = await Promise.all([
      service.from('portal_members').select('role')
        .eq('user_id', user.id).eq('session_id', sessionId).maybeSingle(),
      service.from('portal_access').select('client_slug')
        .eq('email', user.email ?? '').eq('client_slug', 'mate').maybeSingle(),
    ]);
    isMember = !!memberRes.data;
    isInternal = !!internalRes.data;
  }

  const access = resolveDashAccess({
    sessionExists: !!session,
    isDemo: !!session?.is_demo,
    hasUser: !!user,
    isMember,
    isInternal,
  });

  if (access === 'not-found') return { ok: false, status: 404, error: 'session not found' };
  if (access === 'login') return { ok: false, status: 401, error: 'Sign in required.' };
  if (access === 'forbidden') return { ok: false, status: 403, error: 'Not your dashboard.' };
  return { ok: true, access };
}
