// Which Google (Gemini) key pays for, and sees, a tenant's AI calls.
//
// Each client's AI usage runs on its own Google AI Studio key, so cost and data
// stay separated per client. The map below is session id -> env var NAME. It
// never holds a key value: values live in the deployment env (and the AMOS
// secret helper), never in the DB or git.
//
// Sam Carson's businesses share one key, GEMINI_API_KEY_CARSON (AI Studio
// project gen-lang-client-0906318335). Anything not listed (the public demo
// dashboard, the prospect demo funnel, internal use, clients not yet on their
// own key) stays on the shared GEMINI_API_KEY.
//
// The session id handed in must be the one the request was AUTHORIZED for
// (checkDashApiAccess for a dashboard user, the token-gated machine caller's
// session for n8n), never a raw request value that skipped that check. That is
// what keeps a user of tenant A from spending tenant B's key.
//
// Fail closed: a mapped tenant whose variable is missing gets no key at all,
// not the shared one. Falling back would silently bill that client's usage to,
// and route its data through, the shared project, which is the thing this
// exists to stop.

import { normalizeSessionId } from '@/lib/supabase/tenancy';

export const SHARED_GEMINI_KEY_ENV = 'GEMINI_API_KEY';

/** J&C Asphalt Paving (Sam Carson). Same session as lib/leads/intakeTenants. */
const JC_SESSION = '61400e73-0570-4167-88d9-d3a69650b15b';

/** Session id (lowercase uuid) -> env var NAME holding that tenant's Gemini key. */
export const TENANT_GEMINI_KEY_ENV: Readonly<Record<string, string>> = {
  [JC_SESSION]: 'GEMINI_API_KEY_CARSON',
};

export type GeminiKey =
  | { ok: true; key: string; envName: string }
  | { ok: false; envName: string };

/** The env var name for a session. null (no tenant) and unmapped sessions get the shared key. */
export function geminiKeyEnvFor(sessionId: string | null): string {
  if (!sessionId) return SHARED_GEMINI_KEY_ENV;
  const id = normalizeSessionId(sessionId);
  return (id && TENANT_GEMINI_KEY_ENV[id]) || SHARED_GEMINI_KEY_ENV;
}

/**
 * The Gemini key for a session. The shared key behaves exactly as before (an
 * unset GEMINI_API_KEY still goes upstream empty and fails there). A mapped
 * tenant with its variable unset is refused, and the log names the variable,
 * never a value.
 */
export function resolveGeminiKey(
  sessionId: string | null,
  env: Record<string, string | undefined> = process.env,
): GeminiKey {
  const envName = geminiKeyEnvFor(sessionId);
  const key = env[envName] ?? '';
  if (envName === SHARED_GEMINI_KEY_ENV) return { ok: true, key, envName };
  if (!key.trim()) {
    console.error(
      `[gemini-key] ${envName} is not set. Refusing this tenant's Gemini call rather than using ${SHARED_GEMINI_KEY_ENV}.`,
    );
    return { ok: false, envName };
  }
  return { ok: true, key, envName };
}
