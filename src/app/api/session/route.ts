import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { maskCollectedForClient, isMaskedValue } from "@/lib/mate/mask"

// Columns the client is allowed to read back. Deliberately excludes anything
// sensitive (contact_id, reseller_key, status internals) — the onboarding UI
// only needs what it renders.
//
// SECURITY: `google_token_ref` (the Google OAuth refresh token) MUST NEVER be
// added here. It is a long-lived credential and the GET below returns this exact
// list to the browser. It lives in its own column for precisely this reason —
// keep it out of CLIENT_FIELDS and never `select('*')` in this route.
const CLIENT_FIELDS = "id, mate_name, website_url, brand, collected, step, messages"

/**
 * POST /api/session — create a fresh onboarding session.
 * Body (all optional): { reseller_key?: string }
 * Returns { id }.
 */
export async function POST(req: NextRequest) {
  let body: unknown = {}
  try {
    // A body is optional here; tolerate an empty / missing one.
    const raw = await req.text()
    if (raw.trim() !== "") body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { reseller_key } = (body ?? {}) as { reseller_key?: unknown }
  if (reseller_key !== undefined && typeof reseller_key !== "string") {
    return NextResponse.json(
      { error: "reseller_key must be a string" },
      { status: 400 }
    )
  }

  // Service-role client, created INSIDE the handler, never at module scope.
  // Bypasses RLS so this trusted server route can insert onboarding_sessions.
  const supabase = createServiceClient()

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("onboarding_sessions")
    .insert({
      step: "website",
      status: "in_progress",
      ...(reseller_key ? { reseller_key } : {}),
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}

/**
 * GET /api/session?id=... — load a session for the onboarding UI.
 * 400 if id missing, 404 if not found.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id || id.trim() === "") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from("onboarding_sessions")
    .select(CLIENT_FIELDS)
    .eq("id", id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // Mask server-only fields (EIN -> last 4) before anything leaves the server.
  const safe = {
    ...data,
    collected: maskCollectedForClient(
      (data as { collected?: Record<string, unknown> | null }).collected ?? null
    ),
  }
  return NextResponse.json(safe)
}

// Keys the action cards + chat fallback may write into `collected`. Anything
// not on this list is dropped so a caller cannot poke arbitrary keys into the
// JSONB blob. `collected.company` (research pre-fill) is deliberately NOT
// writable here — it is set server-side only and the merge below preserves it.
const COLLECTED_WHITELIST = new Set<string>([
  // Structured cards
  "services",
  "services_pricing",
  "qualify_criteria",
  "brand_voice",
  "current_phone",
  "forward_confirmed",
  "published",
  "lead_delivery_phone",
  // Contact + carrier basics (collected by chat, mirrored here if a card ever
  // needs to persist them). Kept whitelisted so parity fields have a home.
  "contact_name",
  "contact_email",
  "second_contact",
  "legal_business_name",
  "ein",
  "business_address",
  "dba",
  "notes",
  // Phase 2: color confirm, 10DLC registration, channels, website editor,
  // value-math baselines.
  "brand_colors_confirmed",
  "entity_type",
  "lead_channels",
  "leads_per_week",
  "avg_job_value",
  "website_editor_name",
  "website_editor_contact",
  "website_can_edit",
])

/**
 * Validate + filter an incoming `collected` patch. Returns only the whitelisted
 * keys, or null if the value is not a plain object. Does not mutate the input.
 */
function pickCollected(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (COLLECTED_WHITELIST.has(key)) out[key] = value
  }
  // Never persist a masked EIN over the real one. A client re-submitting the
  // masked display value is a no-op; only a fresh full EIN overwrites.
  if (isMaskedValue(out.ein)) delete out.ein
  return out
}

// Max length for a mate_name. Long enough for "{Business} Mate" on any real
// business name, short enough to keep the header from breaking and to reject
// junk payloads.
const MATE_NAME_MAX = 60

/**
 * PATCH /api/session — persist small session updates from the UI.
 * Body: { id: string, step?: string, brand?: Brand, mate_name?: string, collected?: object }
 *
 * - `step` / `brand`: used by the website step's manual fallback (bot-walled
 *   site) so the chosen logo + primary color survive a reload.
 * - `mate_name`: the concierge's display name, set by the rename control. Stored
 *   trimmed; must be a non-empty string <= 60 chars.
 * - `collected`: a whitelisted slice written by the action cards. It is
 *   shallow-merged into the existing `collected` (read-modify-write) so a card
 *   save never clobbers other collected fields, including research pre-fill
 *   (`collected.company`) or fields other cards already saved.
 *
 * Only whitelisted fields/keys are writable; anything else is ignored.
 */
export async function PATCH(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { id, step, brand, mate_name, collected } = (body ?? {}) as {
    id?: unknown
    step?: unknown
    brand?: unknown
    mate_name?: unknown
    collected?: unknown
  }

  if (typeof id !== "string" || id.trim() === "") {
    return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (step !== undefined) {
    if (typeof step !== "string") {
      return NextResponse.json({ error: "step must be a string" }, { status: 400 })
    }
    update.step = step
  }
  if (brand !== undefined) {
    if (brand === null || typeof brand !== "object") {
      return NextResponse.json({ error: "brand must be an object" }, { status: 400 })
    }
    update.brand = brand
  }
  if (mate_name !== undefined) {
    if (typeof mate_name !== "string") {
      return NextResponse.json(
        { error: "mate_name must be a string" },
        { status: 400 }
      )
    }
    const trimmed = mate_name.trim()
    if (trimmed === "") {
      return NextResponse.json(
        { error: "mate_name must not be empty" },
        { status: 400 }
      )
    }
    if (trimmed.length > MATE_NAME_MAX) {
      return NextResponse.json(
        { error: `mate_name must be ${MATE_NAME_MAX} characters or fewer` },
        { status: 400 }
      )
    }
    update.mate_name = trimmed
  }

  // A collected patch requires a read-modify-write to merge without clobbering.
  let collectedPatch: Record<string, unknown> | null = null
  if (collected !== undefined) {
    collectedPatch = pickCollected(collected)
    if (collectedPatch === null) {
      return NextResponse.json(
        { error: "collected must be an object" },
        { status: 400 }
      )
    }
  }

  const supabase = createServiceClient()

  if (collectedPatch !== null) {
    // Read the current collected, shallow-merge the whitelisted patch on top,
    // and write it back. This preserves every existing key (company pre-fill,
    // prior card saves) and only overwrites the keys in this patch.
    const { data: existing, error: readError } = await supabase
      .from("onboarding_sessions")
      .select("collected")
      .eq("id", id)
      .maybeSingle()

    if (readError) {
      return NextResponse.json({ error: readError.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    const current =
      existing.collected && typeof existing.collected === "object" && !Array.isArray(existing.collected)
        ? (existing.collected as Record<string, unknown>)
        : {}
    update.collected = { ...current, ...collectedPatch }
  }

  const { data, error } = await supabase
    .from("onboarding_sessions")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  return NextResponse.json({ id: data.id })
}
