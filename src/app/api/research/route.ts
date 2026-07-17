import { NextRequest, NextResponse } from "next/server"
import {
  fetchSite,
  extractBrandFromHtml,
  extractCompanyData,
} from "@/lib/research/website"
import { createServiceClient } from "@/lib/supabase/service"

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
    // other progressively-collected fields.
    const { data: existing } = await supabase
      .from("onboarding_sessions")
      .select("collected")
      .eq("id", sessionId)
      .maybeSingle()

    const currentCollected =
      existing?.collected && typeof existing.collected === "object"
        ? (existing.collected as Record<string, unknown>)
        : {}

    const { error } = await supabase
      .from("onboarding_sessions")
      .update({
        website_url: finalUrl,
        brand,
        collected: { ...currentCollected, company },
        updated_at: new Date().toISOString(),
      })
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
