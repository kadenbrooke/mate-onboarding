// API-route side of ./tenancy: what a route returns for a session this
// deployment does not serve. Null means "served, carry on".
//
//   moved (shared deployment, MATE_MOVED_SESSIONS): 307 to the same path and
//     query on the session's new deployment. 307 keeps the method and body, so
//     a webhook or n8n POST that still targets the old host lands on the new
//     one instead of writing to a project that no longer owns the session.
//   not served (dedicated deployment, session not in MATE_DATA_SESSION_IDS):
//     404, indistinguishable from an unknown session.
import { NextResponse } from 'next/server';
import { routeSession } from './tenancy';

export function unservedSessionResponse(request: Request, sessionId: string): NextResponse | null {
  const route = routeSession(sessionId);
  if (route.served) return null;
  if (route.movedTo) {
    const u = new URL(request.url);
    return NextResponse.redirect(new URL(`${u.pathname}${u.search}`, route.movedTo), 307);
  }
  return NextResponse.json({ error: 'session not found' }, { status: 404 });
}
