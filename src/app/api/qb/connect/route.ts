// GET /api/qb/connect?sessionId=... : start the QBO OAuth consent flow.
//
// This route runs on Vercel and only builds the redirect to Intuit's OWN
// authorization page (the user's browser goes there, not our server -- no
// IP-restricted API call happens here). The IP-restricted token exchange runs
// on the KVM2 rail, triggered by /api/qb/callback.
//
// Security:
//   - Auth-gated: requireDashAccess redirects/404s unless the caller can see
//     this session's dashboard, so a stranger cannot start a connect bound to
//     someone else's session. The public demo session is refused outright.
//   - CSRF: a signed `state` (sessionId + random nonce) plus an HttpOnly nonce
//     cookie. The callback requires both the signature to verify AND the nonce
//     to match, so a forged/replayed authorization redirect cannot connect QBO
//     to a session.

import { NextRequest, NextResponse } from 'next/server';
import { requireDashAccess } from '@/lib/portal/dash-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { qboOAuthConfig } from '@/lib/qbo/config';
import { resolveEndpoints } from '@/lib/qbo/discovery';
import { buildAuthorizeUrl } from '@/lib/qbo/oauth';
import { signState, newNonce, qbStateSecret, QB_STATE_COOKIE } from '@/lib/qbo/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rawSessionId = req.nextUrl.searchParams.get('sessionId') ?? '';
  const sessionId = resolveSessionId(rawSessionId);

  // Redirects (login) or 404s on deny; returns the access mode on allow.
  const access = await requireDashAccess(sessionId);
  // The public demo dashboard has no real books to connect.
  if (access === 'demo') {
    return NextResponse.redirect(new URL(`/dash/${rawSessionId}`, req.url));
  }

  // OAuth app config (clientId + redirectUri; secret is not needed here and
  // never touches this route -- it lives only on the KVM2 rail).
  let cfg;
  try {
    cfg = qboOAuthConfig(false);
  } catch {
    // Not configured yet -> send them back to the dash rather than crash.
    return NextResponse.redirect(new URL(`/dash/${rawSessionId}?qb=unconfigured`, req.url));
  }

  const endpoints = await resolveEndpoints(cfg.environment);
  const nonce = newNonce();
  const state = signState({ sessionId, nonce }, qbStateSecret());
  const authorizeUrl = buildAuthorizeUrl({
    authorizationEndpoint: endpoints.authorization_endpoint,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    state,
  });

  const res = NextResponse.redirect(authorizeUrl);
  // HttpOnly nonce cookie: the callback matches it against the state's nonce.
  res.cookies.set(QB_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax', // must survive the top-level redirect back from Intuit
    path: '/',
    maxAge: 600, // 10 minutes to complete consent
  });
  return res;
}
