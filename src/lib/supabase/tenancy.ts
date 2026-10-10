// Which Supabase project holds this deployment's business data, and which
// tenants (onboarding sessions) this deployment is allowed to serve.
//
// Two projects can be in play:
//   * the CONTROL project (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY):
//     logins (auth.users), portal_members, portal_access, portal_codes,
//     portal_waitlist and our CRM (contacts, nudges, ...). Always this one.
//   * the DATA project: leads, conversations, zone tables, onboarding_sessions.
//     By default the same project as control. A client with its own project
//     gets its own deployment with the three SUPABASE_DATA_* / MATE_DATA_*
//     vars below, and that deployment is locked to the listed sessions.
//
// Modes:
//   shared     none of the data vars set. Byte-identical to the app before
//              dedicated data projects existed. Optional MATE_MOVED_SESSIONS
//              lists sessions that now live on another deployment: their
//              dashboard URLs forward there and this deployment stops serving
//              (or writing) them.
//   dedicated  SUPABASE_DATA_URL + SUPABASE_DATA_SECRET_KEY + MATE_DATA_SESSION_IDS
//              all set. Data reads/writes go to that project, only the listed
//              sessions are served, nothing public (demo, onboarding, signup)
//              is served, and the public demo session can never be listed.
//
// Any half-set or malformed config throws TenancyConfigError: a deployment
// that cannot tell which tenants it serves must refuse, not guess. This code
// path once wrote a paying client's leads into the public demo session.
//
// Pure: reads only the env object it is handed (process.env by default).

import { DEMO_SESSION_ID } from '@/lib/portal/demo';

export type Env = Record<string, string | undefined>;

export type Tenancy =
  | { mode: 'shared'; moved: ReadonlyMap<string, string> }
  | { mode: 'dedicated'; dataUrl: string; dataKey: string; sessions: readonly string[] };

export type SessionRoute =
  | { served: true }
  | { served: false; movedTo: string | null };

export class TenancyConfigError extends Error {
  constructor(message: string) {
    super(`Mate tenancy config: ${message}`);
    this.name = 'TenancyConfigError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DATA_VARS = ['SUPABASE_DATA_URL', 'SUPABASE_DATA_SECRET_KEY', 'MATE_DATA_SESSION_IDS'] as const;

function val(env: Env, name: string): string | null {
  const v = env[name];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Lowercase canonical form, or null when it is not a uuid. */
export function normalizeSessionId(id: string): string | null {
  const t = id.trim().toLowerCase();
  return UUID.test(t) ? t : null;
}

function projectOrigin(url: string, name: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new TenancyConfigError(`${name} is not a URL`);
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    throw new TenancyConfigError(`${name} must be https`);
  }
  return u.origin;
}

function parseSessions(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    if (part.trim() === '') continue;
    const id = normalizeSessionId(part);
    if (!id) throw new TenancyConfigError('MATE_DATA_SESSION_IDS has an entry that is not a session uuid');
    if (id === DEMO_SESSION_ID) {
      throw new TenancyConfigError('MATE_DATA_SESSION_IDS may never include the public demo session');
    }
    if (!out.includes(id)) out.push(id);
  }
  if (out.length === 0) throw new TenancyConfigError('MATE_DATA_SESSION_IDS lists no sessions');
  return out;
}

function parseMoved(raw: string): Map<string, string> {
  const moved = new Map<string, string>();
  for (const part of raw.split(',')) {
    if (part.trim() === '') continue;
    const eq = part.indexOf('=');
    if (eq < 0) throw new TenancyConfigError('MATE_MOVED_SESSIONS entries look like <session uuid>=<https origin>');
    const id = normalizeSessionId(part.slice(0, eq));
    if (!id) throw new TenancyConfigError('MATE_MOVED_SESSIONS has an entry that is not a session uuid');
    if (id === DEMO_SESSION_ID) throw new TenancyConfigError('the public demo session cannot be moved');
    const target = part.slice(eq + 1).trim();
    const origin = projectOrigin(target, 'MATE_MOVED_SESSIONS target');
    if (origin !== target.replace(/\/+$/, '')) {
      throw new TenancyConfigError('MATE_MOVED_SESSIONS targets must be a bare origin (no path)');
    }
    moved.set(id, origin);
  }
  return moved;
}

export function readTenancy(env: Env = process.env): Tenancy {
  const set = DATA_VARS.filter((n) => val(env, n) !== null);
  if (set.length === 0) {
    const movedRaw = val(env, 'MATE_MOVED_SESSIONS');
    return { mode: 'shared', moved: movedRaw ? parseMoved(movedRaw) : new Map() };
  }
  if (set.length !== DATA_VARS.length) {
    const missing = DATA_VARS.filter((n) => !set.includes(n));
    throw new TenancyConfigError(`dedicated data project is half configured, missing ${missing.join(', ')}`);
  }
  if (val(env, 'MATE_MOVED_SESSIONS') !== null) {
    throw new TenancyConfigError('MATE_MOVED_SESSIONS belongs on the shared deployment, not a dedicated one');
  }

  const dataUrl = val(env, 'SUPABASE_DATA_URL')!;
  const dataOrigin = projectOrigin(dataUrl, 'SUPABASE_DATA_URL');
  const controlUrl = val(env, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!controlUrl) throw new TenancyConfigError('NEXT_PUBLIC_SUPABASE_URL (logins) is required');
  // A dedicated data project that is really the shared project would serve a
  // tenant lock over everyone's rows. Refuse it outright.
  if (dataOrigin === projectOrigin(controlUrl, 'NEXT_PUBLIC_SUPABASE_URL')) {
    throw new TenancyConfigError('SUPABASE_DATA_URL must be a different project from NEXT_PUBLIC_SUPABASE_URL');
  }

  return {
    mode: 'dedicated',
    dataUrl,
    dataKey: val(env, 'SUPABASE_DATA_SECRET_KEY')!,
    sessions: parseSessions(val(env, 'MATE_DATA_SESSION_IDS')!),
  };
}

/** Does this deployment serve this session? Not served + movedTo = forward there. */
export function routeSession(sessionId: string, tenancy: Tenancy = readTenancy()): SessionRoute {
  const id = normalizeSessionId(sessionId);
  if (tenancy.mode === 'dedicated') {
    return id && tenancy.sessions.includes(id) ? { served: true } : { served: false, movedTo: null };
  }
  const movedTo = id ? tenancy.moved.get(id) ?? null : null;
  return movedTo ? { served: false, movedTo } : { served: true };
}
