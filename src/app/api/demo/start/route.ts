import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { extractBrandFromHtml, resolveBrandColors } from "@/lib/research/website"
import { fetchSiteGuarded } from "@/lib/demo/fetch-site-guarded"
import { extractCompanyProfile, isUsableName } from "@/lib/demo/extract"
import { buildFrConfig } from "@/lib/demo/fr-config"
import { toE164, genPhoneCode } from "@/lib/demo/phone"
import { checkGuard, MAX_DEMOS_PER_PHONE_PER_DAY, MAX_DEMOS_PER_DAY } from "@/lib/demo/guard"
import { bumpCounter } from "@/lib/demo/counter"

// POST /api/demo/start — the Instant First Responder Demo entry point.
//
// Prospect submits { url, phone }. We:
//   1. validate + normalize phone to E.164 (the caller-ID join key),
//   2. run the abuse guard (per-phone/day + global daily circuit breaker),
//   3. insert a `building` demo_sessions row (with a 4-digit fallback code),
//   4. scrape their site + build an FR persona INLINE, then flip to `ready`.
//
// On success returns { sessionId, phoneCode, demoNumber } so the lander can show
// "now call this number" + the text-first fallback code. Public route (no auth):
// /api/ is allowlisted in the proxy. Trusted server route -> service-role client.

export const runtime = "nodejs"

const DEMO_NUMBER = process.env.DEMO_TELNYX_NUMBER ?? ""

function perPhoneCap(): number {
  const n = Number(process.env.DEMO_MAX_PER_PHONE_PER_DAY)
  return Number.isFinite(n) && n > 0 ? n : MAX_DEMOS_PER_PHONE_PER_DAY
}
function dailyCap(): number {
  const n = Number(process.env.DEMO_MAX_PER_DAY)
  return Number.isFinite(n) && n > 0 ? n : MAX_DEMOS_PER_DAY
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { url, phone } = (body ?? {}) as { url?: unknown; phone?: unknown }

  if (typeof url !== "string" || url.trim() === "") {
    return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 })
  }
  if (typeof phone !== "string" || phone.trim() === "") {
    return NextResponse.json({ error: "Missing or invalid phone" }, { status: 400 })
  }
  const e164 = toE164(phone)
  if (!e164) {
    return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 })
  }

  const supabase = createServiceClient()

  // --- Abuse guard: count today's demos for this phone + globally. ---
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const sinceIso = dayStart.toISOString()

  const [{ count: phoneCount }, { count: totalCount }] = await Promise.all([
    supabase
      .from("demo_sessions")
      .select("id", { count: "exact", head: true })
      .eq("phone", e164)
      .gte("created_at", sinceIso),
    supabase
      .from("demo_sessions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso),
  ])

  const daily = dailyCap()
  const perPhone = perPhoneCap()

  // Fast path (cheap, non-authoritative): reject the obvious over-cap case using
  // the counted rows without touching the atomic counter. Concurrent bursts can
  // slip past this — the DB counter below is the hard, atomic gate (H1).
  const guard = checkGuard(
    { phoneCountToday: phoneCount ?? 0, totalCountToday: totalCount ?? 0 },
    { perPhone, daily }
  )
  if (!guard.allowed) {
    const msg =
      guard.reason === "daily_limit"
        ? "The demo is at capacity for today. Please try again tomorrow."
        : "You have reached today's demo limit. Please try again tomorrow."
    return NextResponse.json({ error: msg, reason: guard.reason }, { status: 429 })
  }

  // Authoritative gate (H1): the increment IS the limit. Global breaker first (the
  // cost backstop always wins), then per-phone. Atomic under concurrency, so N
  // simultaneous requests can never overshoot either cap.
  if (!(await bumpCounter(supabase, "demo_start_global", "-", daily))) {
    return NextResponse.json(
      {
        error: "The demo is at capacity for today. Please try again tomorrow.",
        reason: "daily_limit",
      },
      { status: 429 }
    )
  }
  if (!(await bumpCounter(supabase, "demo_start_phone", e164, perPhone))) {
    return NextResponse.json(
      {
        error: "You have reached today's demo limit. Please try again tomorrow.",
        reason: "phone_limit",
      },
      { status: 429 }
    )
  }

  // --- Insert the building row with a unique fallback code. ---
  // The unique partial index on (phone_code where status='building') protects
  // against collisions; retry a few times on the (rare) conflict.
  let sessionId: string | null = null
  let phoneCode = ""
  for (let attempt = 0; attempt < 5 && !sessionId; attempt++) {
    phoneCode = genPhoneCode()
    const { data, error } = await supabase
      .from("demo_sessions")
      .insert({
        phone: e164,
        phone_code: phoneCode,
        website_url: url,
        status: "building",
      })
      .select("id")
      .single()
    if (!error && data) {
      sessionId = data.id as string
      break
    }
    // 23505 = unique_violation (code collision). Anything else is fatal.
    if (error && (error as { code?: string }).code !== "23505") {
      return NextResponse.json({ error: "Could not start demo" }, { status: 500 })
    }
  }
  if (!sessionId) {
    return NextResponse.json({ error: "Could not start demo, try again" }, { status: 503 })
  }

  // --- Scrape + build the FR persona inline, then flip to ready. ---
  // fetchSiteGuarded adds the SSRF guard + body cap for this PUBLIC route (H3b);
  // a blocked/internal target yields html:null and we fall through to thin-site
  // persona defaults rather than proxying into internal infrastructure.
  //
  // RELIABILITY (Layer 1, upgrade B): scrape+extract is retried ONCE if the first
  // attempt yields no usable business name. extractCompanyProfile already tries
  // deterministic head metadata (JSON-LD/OG/meta) before the LLM; the retry re-
  // fetches with a realistic browser UA (in case the first fetch was bot-walled or
  // served a thin shell) after a small backoff. Only if the retry ALSO comes back
  // without a real name do we fall through to the generic "this business" persona.
  // The retry is capped at one to protect the request latency budget.
  const RETRY_BACKOFF_MS = 600
  try {
    let { html, finalUrl } = await fetchSiteGuarded(url)
    let company = await extractCompanyProfile(html)

    if (!isUsableName(company.name)) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
      const retry = await fetchSiteGuarded(url, { browserUa: true })
      const retryCompany = await extractCompanyProfile(retry.html)
      // Keep the retry's HTML/brand only if it actually got us further (a name, or
      // HTML where the first attempt had none) so a worse retry can't regress us.
      if (isUsableName(retryCompany.name) || (!html && retry.html)) {
        html = retry.html
        finalUrl = retry.finalUrl
        company = retryCompany
      }
    }

    if (!isUsableName(company.name)) {
      // Residual failure: measurable so we can size the case for Layer-2 headless.
      console.warn(
        `[demo/start] generic-persona fallback: no usable business name for ${finalUrl} (session ${sessionId})`
      )
    }

    const baseBrand = extractBrandFromHtml(html ?? "", finalUrl)
    const brand = await resolveBrandColors(baseBrand, html ?? "", finalUrl)
    const frConfig = buildFrConfig(company)

    const { error: upErr } = await supabase
      .from("demo_sessions")
      .update({
        website_url: finalUrl,
        company,
        brand,
        fr_config: frConfig,
        status: "ready",
      })
      .eq("id", sessionId)

    if (upErr) {
      await supabase
        .from("demo_sessions")
        .update({ status: "failed", error: upErr.message })
        .eq("id", sessionId)
      return NextResponse.json({ error: "Could not build your demo agent" }, { status: 500 })
    }

    return NextResponse.json({
      sessionId,
      phoneCode,
      demoNumber: DEMO_NUMBER,
      businessName: frConfig.business_name,
    })
  } catch (err) {
    await supabase
      .from("demo_sessions")
      .update({ status: "failed", error: String((err as Error)?.message ?? err) })
      .eq("id", sessionId)
    return NextResponse.json({ error: "Could not build your demo agent" }, { status: 500 })
  }
}
