import { NextRequest, NextResponse } from "next/server"
import {
  fetchSite,
  extractBrandFromHtml,
  extractCompanyData,
} from "@/lib/research/website"
import { createServiceClient } from "@/lib/supabase/service"
import { defaultMateName } from "@/lib/mate/name"

export async function POST(req: NextRequest) {
  // Parse + validate body. Bad JSON or missing url => 400, don't throw.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { url, sessionId } = (body ?? {}) as {
    url?: unknown
    sessionId?: unknown
  }

  if (typeof url !== "string" || url.trim() === "") {
    return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 })
  }
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId must be a string" },
      { status: 400 }
    )
  }

  const { html, finalUrl } = await fetchSite(url)
  const brand = extractBrandFromHtml(html ?? "", finalUrl)
  const company = await extractCompanyData(html)
  const botWalled = html === null

  if (sessionId) {
    // Service-role client, created INSIDE the handler, never at module scope.
    // Bypasses RLS so this trusted server route can persist to onboarding_sessions.
    const supabase = createServiceClient()

    // Read the current collected blob so we shallow-merge instead of clobbering
    // other progressively-collected fields, and the current mate_name so we only
    // seed the default name when the owner hasn't already customized it.
    const { data: existing } = await supabase
      .from("onboarding_sessions")
      .select("collected, mate_name")
      .eq("id", sessionId)
      .maybeSingle()

    const currentCollected =
      existing?.collected && typeof existing.collected === "object"
        ? (existing.collected as Record<string, unknown>)
        : {}

    const update: Record<string, unknown> = {
      website_url: finalUrl,
      brand,
      collected: { ...currentCollected, company },
      updated_at: new Date().toISOString(),
    }

    // Seed the default "{Business} Mate" name the first time we learn the
    // business name, but only if mate_name is still unset. Never overwrite a
    // name the owner already customized via the rename control.
    const existingName =
      typeof existing?.mate_name === "string" ? existing.mate_name.trim() : ""
    if (!existingName && company?.name && company.name.trim() !== "") {
      update.mate_name = defaultMateName(company.name)
    }

    const { error } = await supabase
      .from("onboarding_sessions")
      .update(update)
      .eq("id", sessionId)

    if (error) {
      // Research succeeded; the save did not. Report it rather than silently
      // swallowing so the caller knows the row wasn't persisted.
      return NextResponse.json(
        { brand, company, botWalled, saveError: error.message },
        { status: 200 }
      )
    }
  }

  return NextResponse.json({ brand, company, botWalled })
}
