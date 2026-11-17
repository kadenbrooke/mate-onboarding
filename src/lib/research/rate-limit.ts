// Per-IP daily cap for anonymous /api/research calls (no sessionId).
//
// An anonymous research call fetches a caller-named site and spends Claude
// credit on the extraction, with nobody signed in to hold accountable. The only
// in-app caller (the onboarding website step) always sends its sessionId, which
// is authorized by checkOnboardingAccess instead, so this cap is set for abuse,
// not for normal use.
//
// Same atomic counter as the demo's abuse guard (demo_counter_bump through
// bumpCounter: the increment is the gate, it fails closed on a DB error, and the
// daily rows are pruned by the existing cron). The key is an HMAC of the IP, as
// the referral limiter stores it, so no raw address is kept.

import { createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bumpCounter } from '@/lib/demo/counter';

export const RESEARCH_SCOPE = 'research_anon_ip';
export const RESEARCH_ANON_PER_IP_PER_DAY = 5;

/**
 * The caller's IP as the proxy in front of Mate saw it. X-Real-IP is set by
 * Traefik (KVM2) and Vercel, so it wins. Otherwise the RIGHTMOST
 * X-Forwarded-For entry, the one the nearest proxy appended: the leftmost is
 * whatever the client sent and would let anyone rotate past the cap.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const hops = req.headers.get('x-forwarded-for')?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  return hops.at(-1) || 'unknown';
}

export function ipKey(ip: string, env: Record<string, string | undefined> = process.env): string {
  const secret = env.REFERRAL_RATE_LIMIT_SALT || env.SUPABASE_SECRET_KEY || 'mate-research-rate-limit';
  return createHmac('sha256', secret).update(ip).digest('hex');
}

/** True when this anonymous call is within today's cap (and counts it). */
export function allowAnonymousResearch(supabase: SupabaseClient, req: Request): Promise<boolean> {
  return bumpCounter(supabase, RESEARCH_SCOPE, ipKey(clientIp(req)), RESEARCH_ANON_PER_IP_PER_DAY);
}
