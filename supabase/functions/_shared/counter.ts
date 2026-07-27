// Atomic per-day counter helper (Deno mirror of src/lib/demo/counter.ts).
//
// Backs CRITICAL FIX C2(b) (global outbound-SMS breaker) and HIGH FIX H4 (inbound
// code-attempt throttle) in the demo edge functions. demo_counter_bump() does an
// increment-under-cap in one statement so the INCREMENT IS THE GATE — no TOCTOU.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4"

/**
 * Atomically bump the (today, scope, key) counter if it is below `cap`. Returns
 * true when ALLOWED (bump applied), false when BLOCKED (at cap) OR on RPC error —
 * fail CLOSED, since these guard cost/abuse and a DB error must not open the gate.
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
  if (error) return false
  return data === true
}
