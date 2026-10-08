import type { SupabaseClient } from '@supabase/supabase-js';

export const PRACTICE_LABEL = 'Practice';

type PracticeStatus =
  | { ok: true; isPractice: boolean }
  | { ok: false; error: string };

/** Read the tenant safety marker before any outbound provider call. */
export async function practiceStatus(
  client: SupabaseClient,
  sessionId: string,
): Promise<PracticeStatus> {
  const { data, error } = await client
    .from('onboarding_sessions')
    .select('is_practice')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'session not found' };
  return { ok: true, isPractice: data.is_practice === true };
}

/** Keep the safety label visible without duplicating it on repeated resets. */
export function practiceCompanyName(name: string | null | undefined, isPractice: boolean): string | null {
  const trimmed = name?.trim() || '';
  if (!isPractice) return trimmed || null;
  if (!trimmed) return PRACTICE_LABEL;
  if (/\bpractice\b/i.test(trimmed)) return trimmed;
  return `${PRACTICE_LABEL} | ${trimmed}`;
}

/** The dashboard thread's visible receipt for a provider-free practice send. */
export function fakePracticeMessage(text: string, recipient = 'lead'): string {
  return `[Practice fake sent to ${recipient}] ${text}`;
}
