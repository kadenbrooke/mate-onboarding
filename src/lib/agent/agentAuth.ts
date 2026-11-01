import { createHash, timingSafeEqual } from 'crypto';

// Auth for the n8n -> Mate agent routes (postcall, quote-scan).
//
// Primary: header `x-agent-token` equal to MATE_AGENT_TOKEN. n8n sends it from a
// Header Auth credential, so the token never sits in a URL (n8n exports, access
// logs, request logs).
//
// Legacy, for the key rotation only: query `k` equal to AGENT_WEBHOOK_TOKEN.
// Removing AGENT_WEBHOOK_TOKEN from the deployment turns the query path off with no
// code change. The header token is never accepted as `k`, even if the two env
// values were set equal by mistake.
export const AGENT_TOKEN_HEADER = 'x-agent-token';

// Compare fixed-length SHA-256 digests in constant time, so neither the content nor
// the length of the expected token leaks through timing. An unset token or an empty
// given value never authorizes.
const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();

function same(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export function agentAuthed(request: Request): boolean {
  const headerToken = process.env.MATE_AGENT_TOKEN;
  if (same(request.headers.get(AGENT_TOKEN_HEADER), headerToken)) return true;
  const legacy = process.env.AGENT_WEBHOOK_TOKEN;
  if (!legacy || legacy === headerToken) return false;
  return same(new URL(request.url).searchParams.get('k'), legacy);
}
