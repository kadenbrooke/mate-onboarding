// Proxy-level tenancy routing (lib/supabase/tenancy), run before the auth
// session refresh. Null means "carry on as usual".
//
// shared deployment, session listed in MATE_MOVED_SESSIONS:
//   /dash/<id>/...      page: 307 to the same path on its new deployment, where
//                       the user signs in on that domain.
//   /api/dash/<id>/...  dashboard API: 410, never a redirect. A stale tab would
//                       otherwise replay its request at the new domain without
//                       that domain's cookie; 410 tells it to reload instead,
//                       which lands on the page redirect above. (The api-gate
//                       answers the same 410 for the other session-scoped APIs.)
//   Everything else is untouched; with MATE_MOVED_SESSIONS unset this returns
//   null for every request.
// dedicated deployment: deny by default. Only the served sessions' dashboards,
//   the login flow, and the API routes that a served session's dashboard, crons
//   and webhooks use are reachable. The public demo, onboarding, signup,
//   waitlist, code claiming and the internal app shell 404, so none of them can
//   create or read rows in a client's own data project.
//
// A malformed tenancy config answers 503 for every request: never guess.
import { NextResponse, type NextRequest } from 'next/server';
import { resolveSessionId } from '@/lib/portal/demo';
import { readTenancy, routeSession, type Tenancy } from './tenancy';

const DEDICATED_EXACT = new Set([
  '/login',
  '/postlogin',
  '/auth/callback',
  '/auth/signout',
  '/api/ads/refresh',
  '/api/calendar/sync',
  '/api/leads/ingest',
  '/api/manifest',
  '/api/assistant/chat',
  '/api/assistant/chats',
  '/api/connect/google',
  '/api/connect/google/callback',
  '/api/qb/connect',
  '/api/qb/callback',
  '/api/agent/postcall',
  '/api/agent/quote-scan',
  '/api/agent/signal',
  '/api/webhooks/calcom',
]);

// Per-lead and per-chat routes: the route itself resolves the row's session and
// runs it through the tenancy-aware api-gate.
const DEDICATED_PREFIXES = ['/api/assistant/chats/', '/api/leads/'];

const DASH_PATH = /^\/(?:api\/)?dash\/([^/]+)(?:\/|$)/;

function notFound(path: string): NextResponse {
  return path.startsWith('/api/')
    ? NextResponse.json({ error: 'not found' }, { status: 404 })
    : new NextResponse('Not found', { status: 404 });
}

function dashSession(path: string): string | null {
  const m = DASH_PATH.exec(path);
  if (!m) return null;
  try {
    return resolveSessionId(decodeURIComponent(m[1]));
  } catch {
    return m[1];
  }
}

export function tenantRoute(request: NextRequest): NextResponse | null {
  let tenancy: Tenancy;
  try {
    tenancy = readTenancy();
  } catch {
    return new NextResponse('Service unavailable', { status: 503 });
  }

  const path = request.nextUrl.pathname;
  const sessionId = dashSession(path);

  if (tenancy.mode === 'shared') {
    if (!sessionId) return null;
    const route = routeSession(sessionId, tenancy);
    if (route.served || !route.movedTo) return null;
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'This dashboard has moved. Reload the page.' }, { status: 410 });
    }
    return NextResponse.redirect(new URL(`${path}${request.nextUrl.search}`, route.movedTo), 307);
  }

  if (sessionId) return routeSession(sessionId, tenancy).served ? null : notFound(path);
  if (path === '/') return NextResponse.redirect(new URL('/postlogin', request.url));
  if (DEDICATED_EXACT.has(path) || DEDICATED_PREFIXES.some((p) => path.startsWith(p))) return null;
  return notFound(path);
}
