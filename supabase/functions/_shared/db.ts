// Shared Supabase admin client + demo_sessions helpers for the demo edge
// functions. Service-role key (bypasses RLS) — edge functions are trusted server
// code, never the browser.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4"

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  )
}

export interface FrConfig {
  system_prompt?: string
  greeting?: string
  business_name?: string
  voice?: string
}

export interface DemoSession {
  id: string
  phone: string | null
  phone_code: string | null
  fr_config: FrConfig | null
  status: string
}

/**
 * Find the newest READY demo session for a caller phone (the caller-ID join key).
 * Returns null when none is ready (unknown caller / expired / not built yet).
 */
export async function findReadyByPhone(
  supabase: SupabaseClient,
  phone: string
): Promise<DemoSession | null> {
  const { data } = await supabase
    .from("demo_sessions")
    .select("id, phone, phone_code, fr_config, status")
    .eq("phone", phone)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as DemoSession | null) ?? null
}

/**
 * Find the BUILDING session for a 4-digit fallback code (no-caller-ID path). The
 * unique partial index guarantees at most one building row per code.
 */
export async function findBuildingByCode(
  supabase: SupabaseClient,
  code: string
): Promise<DemoSession | null> {
  const { data } = await supabase
    .from("demo_sessions")
    .select("id, phone, phone_code, fr_config, status")
    .eq("phone_code", code)
    .eq("status", "building")
    .limit(1)
    .maybeSingle()
  return (data as DemoSession | null) ?? null
}

/** Mark a session texted (the text-back fired). Best-effort. */
export async function markTexted(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from("demo_sessions").update({ status: "texted" }).eq("id", id)
}

export interface ConvoRow {
  messages: unknown[]
  reply_count: number
}

/**
 * Load the (from_number, business) conversation row: its bounded message history
 * and per-sender assistant-reply count (C2(a)). Returns zeroed defaults when no row
 * exists yet. Never throws.
 */
export async function loadConversation(
  supabase: SupabaseClient,
  fromNumber: string,
  business: string
): Promise<ConvoRow> {
  const { data } = await supabase
    .from("demo_sms_conversations")
    .select("messages, reply_count")
    .eq("from_number", fromNumber)
    .eq("business", business)
    .maybeSingle()
  const messages = Array.isArray((data as { messages?: unknown })?.messages)
    ? ((data as { messages: unknown[] }).messages)
    : []
  const reply_count =
    typeof (data as { reply_count?: unknown })?.reply_count === "number"
      ? (data as { reply_count: number }).reply_count
      : 0
  return { messages, reply_count }
}

/**
 * Upsert a conversation thread on the composite PK (from_number, business). When
 * bumpReply is true, reply_count is set to the provided nextReplyCount (the caller
 * computed it from the loaded row) so the per-sender cap advances atomically with
 * the message write. Never throws on the happy path; caller handles errors.
 */
export async function upsertConversation(
  supabase: SupabaseClient,
  fromNumber: string,
  business: string,
  messages: unknown[],
  nextReplyCount?: number
): Promise<void> {
  const row: Record<string, unknown> = {
    from_number: fromNumber,
    business,
    messages,
    updated_at: new Date().toISOString(),
  }
  if (typeof nextReplyCount === "number") row.reply_count = nextReplyCount
  await supabase
    .from("demo_sms_conversations")
    .upsert(row, { onConflict: "from_number,business" })
}
