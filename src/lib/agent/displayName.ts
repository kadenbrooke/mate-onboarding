import { intakeTenantFor } from '@/lib/leads/intakeTenants';

/** Product/app name remains Mate; this is only the texting agent's persona. */
export const DEFAULT_AGENT_DISPLAY_NAME = 'Mate';

/** Resolve a tenant's user-facing texting-agent name without affecting other tenants. */
export function agentDisplayNameForSession(sessionId: string): string {
  const configured = intakeTenantFor(sessionId)?.agentName?.trim();
  return configured || DEFAULT_AGENT_DISPLAY_NAME;
}
