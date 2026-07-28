// Atomic per-day counter helper for the Instant First Responder Demo.
//
// Backs HIGH FIX H1 (start-route TOCTOU) and CRITICAL FIX C2(b) (global outbound-SMS
// breaker). The authoritative limit lives in Postgres: demo_counter_bump() does an
// increment-under-cap in a single statement, so the INCREMENT IS THE GATE and N
// concurrent callers can never overshoot. This helper is the thin app-side caller.
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Atomically bump the (today, scope, key) counter if it is below `cap`. Returns
 * true when the caller is ALLOWED (bump applied), false when BLOCKED (already at
 * cap) OR when the RPC errors — fail-CLOSED, since these guard cost/abuse and a DB
 * error must not silently open the gate.
 */
export async function bumpCounter(
  supabase: SupabaseClient,
  scope: string,
  key: string,
  cap: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc("demo_counter_bump", {
    p_scope: scope,
    p_key: key,
    p_cap: cap,
  })
  if (error) return false // fail closed: a broken breaker must not allow spend
  return data === true
}
