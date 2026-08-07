// GET /api/qb/callback?code=...&state=...&realmId=... : QBO OAuth redirect
// receiver.
//
// Intuit sends the browser back here after consent. This route runs on Vercel
// and does NOT call Intuit (no IP-restricted call). It:
//   1. Verifies CSRF: the signed `state` must verify AND its nonce must equal
//      the HttpOnly cookie set at /api/qb/connect.
//   2. Re-checks authorization on the resolved session (requireDashAccess), so
//      a valid-but-someone-else's session in the state still can't be connected.
//   3. Hands the authorization `code` + `realmId` to the KVM2 rail, which does
//      the token exchange from the whitelisted IP and stores/rotates the tokens
//      in qb_connections.
//   4. Redirects back to the dashboard with a status flag.
//
// The `code` is single-use and short-lived; it is forwarded to the rail and
// never persisted here.

import { NextRequest, NextResponse } from 'next/server';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { qboEnvironment } from '@/lib/qbo/config';
import { verifyState, qbStateSecret, QB_STATE_COOKIE } from '@/lib/qbo/state';
import { requestTokenExchange } from '@/lib/qbo/rail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function backToDash(req: NextRequest, sessionId: string, status: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/dash/${sessionId}?qb=${status}`, req.url));
  // Consume the one-shot nonce cookie regardless of outcome.
  res.cookies.set(QB_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const realmId = url.searchParams.get('realmId');
  const oauthError = url.searchParams.get('error');

  // 1. Verify the signed state first -- it carries the only trustworthy
  //    session id. Everything downstream keys off the verified value. An unset
  //    signing secret fails closed (no state can be trusted).
  const secret = safeSecret();
  const state = secret && stateParam ? verifyState(stateParam, secret) : null;
  if (!state) {
    // No trustworthy session to route back to; go to login.
    return NextResponse.redirect(new URL('/login?error=qb_state', req.url));
  }

  // Nonce cookie must match the state's nonce (CSRF double-submit).
  const cookieNonce = req.cookies.get(QB_STATE_COOKIE)?.value ?? '';
  if (!cookieNonce || cookieNonce !== state.nonce) {
    return backToDash(req, state.sessionId, 'csrf');
  }

  // User declined consent on Intuit's screen, or Intuit reported an error.
  if (oauthError) return backToDash(req, state.sessionId, 'declined');
  if (!code || !realmId) return backToDash(req, state.sessionId, 'missing');

  // 2. Re-authorize on the verified session (defense in depth: the browser must
  //    still be allowed to see this dashboard).
  const access = await requireDashAccess(state.sessionId);
  if (access === 'demo') return backToDash(req, state.sessionId, 'demo');

  // 3. Hand off to the KVM2 rail for the actual token exchange + storage.
  const result = await requestTokenExchange({
    sessionId: state.sessionId,
    realmId,
    code,
    environment: qboEnvironment(),
  });

  if (!result.ok) {
    // Structured server-side log; the browser only sees a generic flag.
    console.error('[qb/callback] rail exchange failed', {
      sessionId: state.sessionId,
      realmId,
      status: result.status,
      error: result.error,
    });
    return backToDash(req, state.sessionId, 'exchange_failed');
  }

  return backToDash(req, state.sessionId, 'connected');
}

// qbStateSecret throws if unset; a callback with no secret configured should
// fail closed to login, not 500.
function safeSecret(): string {
  try {
    return qbStateSecret();
  } catch {
    return '';
  }
}
