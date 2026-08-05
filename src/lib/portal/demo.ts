// The shared, publicly viewable sample dashboard shown to waitlisted users.
// is_demo=true session, seeded with sample data. requireDashAccess treats it
// as public, so any authed (or even anonymous) visitor can view it.
export const DEMO_SESSION_ID = "b7573135-d4ec-43bb-bf33-a1d365739784";

// Friendly alias for the demo dashboard. The [sessionId] segment is a uuid
// column everywhere it's queried, so the literal "demo" must be swapped for the
// real demo UUID BEFORE any DB read (Postgres rejects "demo" as invalid uuid
// syntax, which would otherwise 404 the page). Applied at the top of every
// /dash surface + the access gate so /dash/demo resolves to the same public
// is_demo=true session as /dash/<uuid>, with identical (public) auth handling.
export const DEMO_ALIAS = "demo";

export function resolveSessionId(sessionId: string): string {
  return sessionId === DEMO_ALIAS ? DEMO_SESSION_ID : sessionId;
}
