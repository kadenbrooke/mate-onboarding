import { NextRequest, NextResponse } from "next/server"
import {
  extractBrandFromHtml,
  resolveBrandColors,
  extractCompanyData,
} from "@/lib/research/website"
import { createServiceClient } from "@/lib/supabase/service"
import { defaultMateName } from "@/lib/mate/name"
import { checkOnboardingAccess } from "@/lib/portal/onboarding-gate"
import { fetchSiteGuarded } from "@/lib/demo/fetch-site-guarded"
import { allowAnonymousResearch } from "@/lib/research/rate-limit"

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

  // Saving the result writes that session's `collected` profile, so the caller
  // must be allowed to open it (checkOnboardingAccess). Checked before the
  // scrape, so a refused caller costs nothing.
  if (sessionId) {
    const access = await checkOnboardingAccess(req, sessionId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
  } else if (!(await allowAnonymousResearch(createServiceClient(), req))) {
    // No session: nobody is signed in to hold accountable for the fetch and the
    // Claude extraction, so a per-IP daily cap applies (fails closed).
    return NextResponse.json({ error: "Too many lookups today. Try again tomorrow." }, { status: 429 })
  }

  // The caller names the URL, so the fetch is SSRF-guarded (no private,
  // loopback or metadata addresses, every redirect hop re-checked). The brand
  // step's logo, stylesheet and manifest fetches go through the same guard.
  const { html, finalUrl, blocked } = await fetchSiteGuarded(url)
  if (blocked) {
    return NextResponse.json({ error: "That address cannot be looked up." }, { status: 400 })
  }
  const baseBrand = extractBrandFromHtml(html ?? "", finalUrl)
  // Resolve real brand colors via the source chain (logo palette -> theme-color
  // -> manifest -> defaults). Non-throwing; research must never 500.
  const brand = await resolveBrandColors(baseBrand, html ?? "", finalUrl)
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
