// Authorization for the onboarding-flow routes that read or write a session by
// a caller-supplied id: /api/mate, /api/sandbox, /api/session (GET, PATCH),
// /api/mate/complete, /api/research, /api/portal and the Google connect pair.
//
// Knowing a session id is not authorization: ids appear in every onboarding
// and dashboard URL. Before this gate these routes checked nothing, or only that
// SOME user was signed in, so any caller could read or write another tenant's
// session by sending its id.
//
// A request is allowed when either holds:
//   1. checkDashApiAccess allows the session: a demo session (public by
//      design), a portal member of THIS session, or an internal user. Sessions
//      created through an access code (lib/portal/provision) have a member row.
//   2. The user is signed in AND the browser carries the signed mate_session
//      cookie for THIS exact session. POST /api/session sets that cookie when
//      a signed-in user starts onboarding, and such a session has no member
//      row until it is provisioned, so the cookie is what binds it to them.
// Everything else is refused with the gate's own status (401 signed out,
// 403 someone else's session, 404 unknown or not served here).

import { checkDashApiAccess } from './api-gate';
import type { DashAccess } from './dash-access';
import { COOKIE_NAME, verifySession } from '@/lib/session-cookie';

/** How the caller got in: the dash gate's verdict, or 'creator' via the signed cookie. */
export type OnboardingAccess = Extract<DashAccess, 'demo' | 'member' | 'internal'> | 'creator';

export type OnboardingVerdict =
  | { ok: true; access: OnboardingAccess }
  | { ok: false; status: number; error: string };

/** The session id the signed mate_session cookie vouches for, or null. */
export function cookieSessionId(req: Request, env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.MATE_SESSION_SECRET;
  if (!secret) return null;
  const raw = req.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))?.[1];
  if (!raw) return null;
  let token: string;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return verifySession(token, secret);
}

export async function checkOnboardingAccess(req: Request, sessionId: string): Promise<OnboardingVerdict> {
  const verdict = await checkDashApiAccess(sessionId);
  if (verdict.ok) return { ok: true, access: verdict.access as Extract<DashAccess, 'demo' | 'member' | 'internal'> };
  // 403 = signed in, session exists and is served here, but no membership.
  // The creator's own signed cookie for this exact session is the other proof.
  if (verdict.status === 403 && cookieSessionId(req)?.toLowerCase() === sessionId.trim().toLowerCase()) {
    return { ok: true, access: 'creator' };
  }
  return verdict;
}

/** The refusal for routes that provision or store credentials: never on a public demo session. */
export const DEMO_REFUSED: OnboardingVerdict = { ok: false, status: 403, error: 'Not available on a demo session.' };
