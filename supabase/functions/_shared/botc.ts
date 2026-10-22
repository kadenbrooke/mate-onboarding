// BOTC game-mode divert helpers for demo-sms.
//
// The shared demo number doubles as the SMS rail for the BOTC storyteller. When
// the two BOTC envs are configured AND the inbound sender is a seated player in
// the currently-active BOTC game (cross-project lookup against the dedicated
// botc Supabase project), demo-sms stores the text to the game's sms_inbox and
// stops — the game orchestrator replies via game logic, never the demo.
//
// Design constraints (deliberate):
//   - ENV-GATED: BOTC_SUPABASE_URL + BOTC_SERVICE_KEY unset => botcClient()
//     returns null and demo-sms behaves exactly as before. Demo-only deploys
//     are unaffected.
//   - FAIL-OPEN on lookup: any thrown error or error result from the player
//     lookup is logged and treated as "not a player" — a botc outage must
//     NEVER break the live client demo.
//   - FAIL-CLOSED on insert: once the lookup identified the sender as a game
//     player, a failed sms_inbox insert must surface as a 5xx so Telnyx
//     redelivers — otherwise the player's game text is silently lost. Failing
//     closed here costs the demo nothing (the sender IS a player).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4"

export interface BotcGamePlayer {
  game_id: string
  player_id: string
  seat: number
}

/**
 * Client for the dedicated botc Supabase project, or null when either env is
 * unset (the divert is disabled and demo-sms runs exactly as before).
 */
export function botcClient(): SupabaseClient | null {
  const url = Deno.env.get("BOTC_SUPABASE_URL")
  const key = Deno.env.get("BOTC_SERVICE_KEY")
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Look up the sender in the active BOTC game via the `active_game_player` rpc
 * (the ONLY surface demo-sms touches on the botc project). Returns the first
 * row, or null on miss. Fail-open: any rpc error or throw logs + returns null
 * so the demo paths run unchanged.
 */
export async function findActiveBotcPlayer(
  client: SupabaseClient,
  phone: string
): Promise<BotcGamePlayer | null> {
  try {
    const { data, error } = await client.rpc("active_game_player", { p_phone: phone })
    if (error) {
      console.error("botc active_game_player rpc error:", error.message ?? error)
      return null
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof (row as BotcGamePlayer).game_id !== "string") return null
    return row as BotcGamePlayer
  } catch (err) {
    console.error("botc active_game_player lookup threw:", err)
    return null
  }
}

/**
 * Store an inbound player text to the botc sms_inbox (silent store; the
 * orchestrator polls and replies via game logic). Returns true on success.
 * Errors are logged and return false — the caller must fail CLOSED (5xx so
 * Telnyx redelivers): the sender is already identified as a game player, so
 * swallowing the failure would silently drop their game text.
 */
export async function botcInboxInsert(
  client: SupabaseClient,
  gameId: string,
  phone: string,
  body: string
): Promise<boolean> {
  try {
    const { error } = await client
      .from("sms_inbox")
      .insert({ game_id: gameId, from_phone: phone, body })
    if (error) {
      console.error("botc sms_inbox insert error:", error.message ?? error)
      return false
    }
    return true
  } catch (err) {
    console.error("botc sms_inbox insert threw:", err)
    return false
  }
}
