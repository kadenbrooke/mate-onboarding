import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { materialsForCollected } from "@/lib/materials"

/**
 * POST /api/mate/complete: no-gate auto-provision for a finished onboarding.
 *
 * Given { sessionId }, this route:
 *   1. Loads the session (collected, contact_id, reseller_key).
 *   2. Upserts a CRM contact from `collected` (updates the linked contact if the
 *      session already has one, else inserts a new one and writes the id back).
 *   3. Auto-completes the pipeline materials the onboarding satisfied
 *      (intake_form, scope_lock), idempotent + silent.
 *   4. Seeds the Phase-1 capability manifest (first_responder_sms, gbp_reviews).
 *   5. Marks the session complete.
 *
 * No approval gate: white-label resellers self-provision. Failures on the
 * contact upsert are fatal (nothing downstream can run without it); material /
 * capability failures are collected and reported but do not abort, so the
 * contact + session are never left in a half-provisioned state silently.
 */

// The Signed / Paid pipeline stage has lifecycle_bucket = 'active_client'. We
// assign it so the `contacts_lifecycle_sync` BEFORE trigger derives
// lifecycle = 'active_client' (a stage-less insert would be forced to
// 'cold_outreach' by that trigger) and the client lands on the delivery board.
const SIGNED_PAID_STAGE_ID = "37c2431e-a747-410d-a3c3-2ae0ed901fd4"

type Collected = Record<string, any>

interface CompanyBlob {
  name?: string
}

/**
 * Build the contact field set from a session's `collected` blob. Only maps
 * fields the onboarding actually gathers; leaves the rest to DB defaults.
 */
function contactFieldsFrom(
  collected: Collected,
  resellerKey: string | null
): {
  name: string | null
  company: string | null
  email: string | null
  phone: string | null
  tags: string[]
} {
  const company: CompanyBlob =
    collected?.company && typeof collected.company === "object"
      ? collected.company
      : {}

  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null
    const t = v.trim()
    return t === "" ? null : t
  }

  const name =
    str(collected?.contact_name) ??
    str(company?.name) ??
    str(collected?.legal_business_name)

  const companyName =
    str(company?.name) ?? str(collected?.legal_business_name)

  const email = str(collected?.contact_email)
  const phone = str(collected?.current_phone) ?? str(collected?.lead_delivery_phone)

  const tags = ["mate-onboarded"]
  if (resellerKey) tags.push(`reseller:${resellerKey}`)

  return { name, company: companyName, email, phone, tags }
}

/**
 * Merge onboarding tags into an existing contact's tags without duplicating.
 */
function mergeTags(existing: unknown, incoming: string[]): string[] {
  const base = Array.isArray(existing)
    ? existing.filter((t): t is string => typeof t === "string")
    : []
  const set = new Set(base)
  for (const t of incoming) set.add(t)
  return Array.from(set)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { sessionId } = (body ?? {}) as { sessionId?: unknown }
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return NextResponse.json(
      { error: "Missing or invalid sessionId" },
      { status: 400 }
    )
  }

  // Service-role client, created INSIDE the handler, never at module scope, so
  // the build never requires the secret key.
  const supabase = createServiceClient()

  // 1. Load the session.
  const { data: session, error: loadError } = await supabase
    .from("onboarding_sessions")
    .select("id, collected, contact_id, reseller_key")
    .eq("id", sessionId)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 })
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const collected: Collected =
    session.collected && typeof session.collected === "object"
      ? (session.collected as Collected)
      : {}
  const resellerKey =
    typeof session.reseller_key === "string" && session.reseller_key.trim() !== ""
      ? session.reseller_key.trim()
      : null

  const fields = contactFieldsFrom(collected, resellerKey)

  // 2. Upsert the contact. Never duplicate one already linked to the session.
  let contactId: string
  if (session.contact_id) {
    contactId = session.contact_id as string

    // Read current tags so we merge (union) rather than clobber.
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("tags")
      .eq("id", contactId)
      .maybeSingle()

    const update: Record<string, unknown> = {
      lifecycle: "active_client",
      tags: mergeTags(existingContact?.tags, fields.tags),
      updated_at: new Date().toISOString(),
    }
    // Only overwrite name/company/email/phone when we actually have a value,
    // so we don't wipe existing CRM data with nulls from a sparse onboarding.
    if (fields.name) update.name = fields.name
    if (fields.company) update.company = fields.company
    if (fields.email) update.email = fields.email
    if (fields.phone) update.phone = fields.phone

    const { error: updErr } = await supabase
      .from("contacts")
      .update(update)
      .eq("id", contactId)

    if (updErr) {
      return NextResponse.json(
        { error: `Contact update failed: ${updErr.message}` },
        { status: 500 }
      )
    }
  } else {
    // Insert a new contact. `name` is NOT NULL in the schema, so fall back to a
    // safe placeholder if the onboarding genuinely captured nothing.
    const insert: Record<string, unknown> = {
      name: fields.name ?? "Mate Onboarding Client",
      company: fields.company,
      email: fields.email,
      phone: fields.phone,
      source: "mate-onboarding",
      stage_id: SIGNED_PAID_STAGE_ID, // makes lifecycle sync to 'active_client'
      tags: fields.tags,
    }

    const { data: inserted, error: insErr } = await supabase
      .from("contacts")
      .insert(insert)
      .select("id")
      .single()

    if (insErr || !inserted) {
      return NextResponse.json(
        { error: `Contact insert failed: ${insErr?.message ?? "no row returned"}` },
        { status: 500 }
      )
    }
    contactId = inserted.id as string

    // Write the new contact id back onto the session so a re-run updates rather
    // than duplicates.
    const { error: linkErr } = await supabase
      .from("onboarding_sessions")
      .update({ contact_id: contactId, updated_at: new Date().toISOString() })
      .eq("id", sessionId)

    if (linkErr) {
      // The contact exists but the link failed. Surface it so we don't silently
      // orphan the contact and risk a duplicate on retry.
      return NextResponse.json(
        {
          error: `Contact created but session link failed: ${linkErr.message}`,
          contactId,
        },
        { status: 500 }
      )
    }
  }

  // Non-fatal problems past this point are gathered and reported, not thrown.
  const warnings: string[] = []

  // 3. Auto-complete materials (idempotent, silent). ON CONFLICT bumps
  //    completed_at. Done one-by-one so a single bad key doesn't sink the batch.
  const materialKeys = materialsForCollected(collected)
  const materials: string[] = []
  for (const material_key of materialKeys) {
    const { error: matErr } = await supabase
      .from("contact_materials")
      .upsert(
        {
          contact_id: contactId,
          material_key,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "contact_id,material_key" }
      )
    if (matErr) {
      warnings.push(`material ${material_key}: ${matErr.message}`)
    } else {
      materials.push(material_key)
    }
  }

  // 4. Seed the Phase-1 capability manifest. gbp_reviews goes live only if the
  //    Google Business connection completed during onboarding.
  const gbpLive = collected?.google_connected === true
  const capabilitySeed = [
    {
      capability_key: "first_responder_sms",
      label: "Missed-call text-back + lead qualifier",
      // Seeded as a playable DEMO: the sandbox on the Command Center's First
      // Responder card works from day one while the real build + 10DLC
      // registration happen. Kaden flips this to 'live' at go-live.
      status: "demo",
    },
    {
      capability_key: "gbp_reviews",
      label: "Google reviews + responses",
      status: gbpLive ? "live" : "under_construction",
    },
  ]

  const capabilities: string[] = []
  for (const cap of capabilitySeed) {
    const { error: capErr } = await supabase
      .from("client_capabilities")
      .upsert(
        { contact_id: contactId, ...cap },
        { onConflict: "contact_id,capability_key" }
      )
    if (capErr) {
      warnings.push(`capability ${cap.capability_key}: ${capErr.message}`)
    } else {
      capabilities.push(cap.capability_key)
    }
  }

  // 5. Mark the session complete.
  const { error: doneErr } = await supabase
    .from("onboarding_sessions")
    .update({
      status: "complete",
      step: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)

  if (doneErr) {
    warnings.push(`session status: ${doneErr.message}`)
  }

  return NextResponse.json({
    contactId,
    materials,
    capabilities,
    ...(warnings.length ? { warnings } : {}),
  })
}
