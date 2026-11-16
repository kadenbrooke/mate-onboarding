// Which model runs a tenant's AI calls, when it differs from TASK_MODELS.
//
// J&C Asphalt Paving moved off its own Gemini key (GEMINI_API_KEY_CARSON,
// prepaid credit empty since 2026-10-31) onto Claude on 2026-11-16 (founder
// ruling: "move it all to claude"). Claude calls run on the Max plan's API
// credit through ANTHROPIC_API_KEY, still through the Portkey gateway as
// x-portkey-provider: anthropic. Cheapest Claude model that clears each bar:
// Haiku for call-note extraction, Sonnet for the dashboard assistant and for
// reading a photographed lead note.
//
// Same contract as ./geminiKey: the session id handed in must be the one the
// request was AUTHORIZED for, never a raw request value, so a user of tenant A
// can never pick tenant B's route. Anything not listed (the public demo
// dashboard, the prospect demo funnel, other clients) keeps TASK_MODELS.

import { normalizeSessionId } from '@/lib/supabase/tenancy';
import type { TaskClass } from './portkey';

/** J&C Asphalt Paving (Sam Carson). Same session as ./geminiKey and lib/leads/intakeTenants. */
const JC_SESSION = '61400e73-0570-4167-88d9-d3a69650b15b';

/** Session id (lowercase uuid) -> per-class model override, `creator/model` like TASK_MODELS. */
export const TENANT_TASK_MODELS: Readonly<Record<string, Readonly<Partial<Record<TaskClass, string>>>>> = {
  [JC_SESSION]: {
    extract: 'anthropic/claude-haiku-5-5',
    assistant: 'anthropic/claude-sonnet-5-5',
    vision: 'anthropic/claude-sonnet-5-5',
  },
};

/** The tenant's model for a class, or null when the tenant has no override (use TASK_MODELS). */
export function tenantModelFor(sessionId: string | null, cls: TaskClass): string | null {
  if (!sessionId) return null;
  const id = normalizeSessionId(sessionId);
  if (!id || !Object.hasOwn(TENANT_TASK_MODELS, id)) return null;
  return TENANT_TASK_MODELS[id][cls] ?? null;
}
