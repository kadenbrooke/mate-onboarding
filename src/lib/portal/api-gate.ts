// API-route twin of dash-gate. Same access model (portal_members membership or
// internal portal_access, demo sessions open), but it RETURNS a verdict instead
// of calling notFound()/redirect(), which are page-only primitives.
//
// Destructive mutations must use this rather than "the caller knew the session
// UUID", which is not authorization: session ids appear in every dashboard URL.
//
// Tenancy first (see lib/supabase/tenancy): a session this deployment does not
// serve is refused before any data read. Membership is read from the control
// project (where the logins live); the session row from the data project.
import { createClient } from '@/lib/supabase/server';
import { createControlServiceClient, createServiceClient } from '@/lib/supabase/service';
import { readTenancy, routeSession } from '@/lib/supabase/tenancy';
import { resolveDashAccess, type DashAccess } from './dash-access';

export type DashApiVerdict =
  | { ok: true; access: DashAccess }
  | { ok: false; status: number; error: string };

export async function checkDashApiAccess(sessionId: string): Promise<DashApiVerdict> {
  const tenancy = readTenancy();
  const route = routeSession(sessionId, tenancy);
  if (!route.served) {
    return route.movedTo
      ? { ok: false, status: 410, error: 'This dashboard has moved. Reload the page.' }
      : { ok: false, status: 404, error: 'session not found' };
  }

  const service = createServiceClient();
  const { data: session } = await service
    .from('onboarding_sessions')
    .select('id, is_demo')
    .eq('id', sessionId)
    .maybeSingle();
  // A dedicated deployment serves nothing publicly.
  if (tenancy.mode === 'dedicated' && session?.is_demo) {
    return { ok: false, status: 404, error: 'session not found' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isMember = false;
  let isInternal = false;
  if (user && session && !session.is_demo) {
    const control = createControlServiceClient();
    const [memberRes, internalRes] = await Promise.all([
      control.from('portal_members').select('role')
        .eq('user_id', user.id).eq('session_id', sessionId).maybeSingle(),
      control.from('portal_access').select('client_slug')
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
