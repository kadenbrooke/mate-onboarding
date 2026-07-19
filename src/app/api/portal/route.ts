import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { COOKIE_NAME } from "@/lib/session-cookie"
import { agentRoster } from "@/lib/portal/capabilities"
import { annualLoss } from "@/lib/mate/loss-math"

/**
 * GET /api/portal?session=<id> — portal data for the post-onboarding client view.
 *
 * Identity model: the portal is keyed by an onboarding session id (same id the
 * onboarding flow used, carried in ?session= or localStorage). The session row
 * carries `contact_id`, set once onboarding completes (see /api/mate/complete).
 * Until that link exists the portal still renders, in an "onboarding not
 * finished" state, so a client who bookmarked the URL early never sees an error.
 *
 * SECURITY: this route returns data to the browser, so it must NEVER leak
 * internal fields. It deliberately does NOT return `reseller_key`, `contact_id`,
 * raw `request_text`, or the raw internal `status` enum of a build request. Build
 * requests are surfaced with a client-safe label + a coarse friendly status only.
 *
 * Soft errors only: a DB hiccup returns an empty-but-valid payload rather than a
 * 500, so a transient failure degrades to "nothing yet" instead of a broken page.
 */

// Build-request statuses that are closed (not shown in the portal's UC zone).
const CLOSED_REQUEST_STATUSES = new Set(["shipped", "declined"])

// Map the internal build_request status enum to a coarse, client-safe label.
// The raw enum (new/scoping/building) is internal vocabulary; the client sees a
// friendly phrase and never the internal token.
function friendlyRequestStatus(status: string | null | undefined): string {
  switch (status) {
    case "building":
      return "In progress"
    case "scoping":
      return "Being scoped"
    case "new":
    default:
      return "Requested"
  }
}

interface EmptyPortal {
  capabilities: []
  buildRequests: []
  mate_name: string | null
  onboardingComplete: false
  agents: []
  baseline: null
  businessName: null
}

function emptyPortal(mateName: string | null): EmptyPortal {
  return {
    capabilities: [],
    buildRequests: [],
    mate_name: mateName,
    onboardingComplete: false,
    agents: [],
    baseline: null,
    businessName: null,
  }
}

export async function GET(req: NextRequest) {
  // An EXPLICIT ?session= param wins on this read-only GET: a fresh portal
  // link must never be shadowed by a stale 90-day cookie from an earlier
  // session (re-onboard / corrected link). The cookie only fills in when no
  // param is present. A stolen-UUID attacker gains nothing from this order:
  // their cookie-less browser hits the param path either way. Write paths
  // (/api/mate) keep cookie-over-body precedence.
  let sessionId = req.nextUrl.searchParams.get("session")
  const secret = process.env.MATE_SESSION_SECRET
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value
  if (!sessionId && secret && cookieToken) {
    const { verifySession } = await import("@/lib/session-cookie")
    const verified = verifySession(cookieToken, secret)
    if (verified) sessionId = verified
  }

  if (!sessionId || sessionId.trim() === "") {
    return NextResponse.json(
      { error: "Missing session" },
      { status: 400 }
    )
  }

  // Service-role client, created INSIDE the handler, never at module scope, so
  // the build never requires the secret key. Bypasses RLS to read the portal
  // tables (RLS-enabled, no anon policies).
  let supabase
  try {
    supabase = createServiceClient()
  } catch {
    // Misconfigured env: degrade to an empty portal rather than 500 the client.
    return NextResponse.json(emptyPortal(null))
  }

  // 1. Load the session -> its contact_id + mate_name. maybeSingle so a bad id
  //    is a soft miss, not an error.
  const { data: session, error: sessionErr } = await supabase
    .from("onboarding_sessions")
    .select("id, contact_id, mate_name, collected")
    .eq("id", sessionId)
    .maybeSingle()

  if (sessionErr || !session) {
    // Unknown session (or read error): portal still renders, unfinished state.
    return NextResponse.json(emptyPortal(null))
  }

  const mateName =
    typeof session.mate_name === "string" && session.mate_name.trim() !== ""
      ? session.mate_name
      : null

  // No contact linked yet -> onboarding not finished. Render the shell with the
  // unfinished state; no capabilities/requests to show.
  if (!session.contact_id) {
    return NextResponse.json(emptyPortal(mateName))
  }

  const contactId = session.contact_id as string

  // 2. Capabilities for this contact. Only the three columns the UI splits on.
  const { data: caps, error: capsErr } = await supabase
    .from("client_capabilities")
    .select("capability_key, label, status")
    .eq("contact_id", contactId)

  const capabilities =
    !capsErr && Array.isArray(caps)
      ? caps.map((c) => ({
          capability_key: String(c.capability_key),
          label: String(c.label),
          status: String(c.status),
        }))
      : []

  // 3. OPEN build requests only (exclude shipped/declined). Select only the
  //    fields we can safely expose, then map to a client-safe shape: a single
  //    label (mate_summary preferred, request_text fallback) + a coarse status
  //    label. reseller_key and the raw internal status enum are NEVER returned.
  const { data: reqs, error: reqsErr } = await supabase
    .from("build_requests")
    .select("request_text, mate_summary, status")
    .eq("contact_id", contactId)
    .not("status", "in", "(shipped,declined)")

  const buildRequests =
    !reqsErr && Array.isArray(reqs)
      ? reqs
          // Belt-and-suspenders: also filter in code in case the DB filter drifts.
          .filter((r) => !CLOSED_REQUEST_STATUSES.has(String(r.status)))
          .map((r) => {
            const summary =
              typeof r.mate_summary === "string" ? r.mate_summary.trim() : ""
            const rawText =
              typeof r.request_text === "string" ? r.request_text : ""
            return {
              // request_text is folded into `label` (not exposed as a raw field);
              // capabilities.ts consumes { request_text, mate_summary, status }.
              request_text: summary || rawText,
              mate_summary: summary,
              // Coarse, client-safe status label only.
              status: friendlyRequestStatus(String(r.status)),
            }
          })
      : []

  // Derive baseline from collected onboarding numbers. Honest: null when inputs
  // absent or zero. NEVER fabricated — only use the client's own numbers.
  const collected =
    session?.collected && typeof session.collected === "object" && !Array.isArray(session.collected)
      ? (session.collected as Record<string, unknown>)
      : {}
  const lpw = Number(collected.leads_per_week)
  const ajv = Number(collected.avg_job_value)
  const loss = annualLoss(lpw, ajv) // null when inputs absent

  const businessName =
    (collected.company && typeof collected.company === "object"
      ? (collected.company as { name?: string }).name
      : null) ?? null

  return NextResponse.json({
    capabilities,
    buildRequests,
    mate_name: mateName,
    onboardingComplete: true,
    agents: agentRoster(capabilities, buildRequests),
    baseline:
      loss === null
        ? null
        : {
            annualLoss: loss,
            leadsPerWeek: lpw,
            avgJobValue: ajv,
          },
    businessName: typeof businessName === "string" && businessName.trim() !== "" ? businessName : null,
  })
}
