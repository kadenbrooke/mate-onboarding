import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

// Columns the client is allowed to read back. Deliberately excludes anything
// sensitive (contact_id, reseller_key, status internals) — the onboarding UI
// only needs what it renders.
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

  return NextResponse.json(data)
}

/**
 * PATCH /api/session — persist small session updates from the UI.
 * Body: { id: string, step?: string, brand?: Brand }
 *
 * Used by the website step's manual fallback (bot-walled site): the chosen
 * logo + primary color are saved here so they survive a reload. Only a
 * whitelist of fields is writable; anything else is ignored.
 */
export async function PATCH(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { id, step, brand } = (body ?? {}) as {
    id?: unknown
    step?: unknown
    brand?: unknown
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

  const supabase = createServiceClient()

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
