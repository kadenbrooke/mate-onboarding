import { NextRequest, NextResponse } from "next/server"
import { createControlServiceClient, createServiceClient } from "@/lib/supabase/service"
import { readTenancy, routeSession } from "@/lib/supabase/tenancy"
import { dataWritesEnabled } from "@/lib/supabase/write-gate"
import { syncSessionCalendar } from "@/lib/metrics/calendarSyncRun"
import { practiceStatus } from "@/lib/portal/practice"
import { publicRedirect } from "@/lib/public-url"
import { pathSegment } from "@/lib/portal/safe-next"
import { checkOnboardingAccess } from "@/lib/portal/onboarding-gate"
import { createClient } from "@/lib/supabase/server"
import {
  GOOGLE_NONCE_SCOPE,
  GOOGLE_STATE_COOKIE,
  checkGoogleCallback,
  googleStateSecret,
  nonceKey,
  verifyGoogleState,
} from "@/lib/portal/google-oauth-state"
import { bumpCounter } from "@/lib/demo/counter"

/**
 * GET /api/connect/google/callback: Google OAuth redirect target.
 *
 * Exchanges the `code` for tokens at Google's token endpoint, records that the
 * connection succeeded, and kicks a FIRST calendar sync so the client sees real
 * appointments the moment they land back on the dashboard instead of waiting
 * for tomorrow's cron. It does NOT call the GBP data API (access gated on
 * Google approval we lack).
 *
 * The refresh token is stored server-side in the dedicated `google_token_ref`
 * COLUMN (never in `collected`, which the session GET returns to the browser)
 * and is NEVER logged. Only the `collected.google_connected` boolean is
 * surfaced to the UI.
 *
 * Any error or missing config redirects back to /onboard with a soft
 * `?google=<reason>` param; we never 500 the user mid-onboarding.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

// Ceiling on the first-pull kick. A Google Calendar pull is normally well under
// a second, but the user is mid-redirect: if Google is slow we abandon the wait
// and let the daily cron backfill rather than hang the flow.
const FIRST_SYNC_TIMEOUT_MS = 8000

function backToOnboard(req: NextRequest, status: string, sessionId: string): NextResponse {
  // A dedicated deployment has no /onboard (lib/supabase/tenant-proxy): send
  // the user back to their own dashboard instead. sessionId comes from a state
  // whose signature verified ("" otherwise), never the raw parameter; it only
  // picks where to send the browser.
  const dedicated = readTenancy().mode === "dedicated"
  const path = !dedicated
    ? "/onboard"
    : sessionId && routeSession(sessionId).served
      ? `/dash/${pathSegment(sessionId)}`
      : "/postlogin"
  return publicRedirect(`${path}?${new URLSearchParams({ google: status })}`, req)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let res: NextResponse
  try {
    res = await connect(req)
  } catch (e) {
    // Never leak details or leave the nonce cookie behind on an unexpected throw.
    console.error("google callback failed", e instanceof Error ? e.message : String(e))
    res = errorResponse(req)
  }
  // The nonce is single-use: clear it on every outcome, the throw included.
  res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/connect/google", maxAge: 0 })
  return res
}

/** A redirect back with ?google=error, or a plain 500 if even that cannot be built. */
function errorResponse(req: NextRequest): NextResponse {
  try {
    return backToOnboard(req, "error", "")
  } catch {
    return NextResponse.json({ error: "Could not finish connecting Google." }, { status: 500 })
  }
}

async function connect(req: NextRequest): Promise<NextResponse> {
  let secret: string | null = null
  try {
    secret = googleStateSecret()
  } catch {
    secret = null
  }
  const stateParam = req.nextUrl.searchParams.get("state")
  // Where to send the browser back to: the session in a correctly signed state.
  const returnSession = (secret && verifyGoogleState(stateParam, secret)?.sessionId) || ""
  const back = (status: string): NextResponse => backToOnboard(req, status, returnSession)

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI

  // Not configured: treat as a soft "connect later", never crash.
  if (!clientId || !clientSecret || !redirectUri) {
    return back("unconfigured")
  }

  // Google returns ?error=access_denied when the user declines. Tolerate it.
  const error = req.nextUrl.searchParams.get("error")
  if (error) {
    return back("denied")
  }

  const code = req.nextUrl.searchParams.get("code")
  if (!code) {
    return back("missing_code")
  }
  // Read-only deployment (lib/supabase/write-gate): nothing may be stored yet,
  // so the code is never exchanged.
  if (!dataWritesEnabled()) return back("writes_disabled")

  // Before ANY read or code exchange: the signed state must verify and be
  // unexpired, this browser's nonce cookie must match it, and the signed-in
  // user must be the one who started the flow (lib/portal/google-oauth-state).
  // Only then is its session id trusted; the raw parameter never is.
  if (!secret) return back("unconfigured")
  const { data: { user } } = await (await createClient()).auth.getUser()
  const check = checkGoogleCallback({
    state: stateParam,
    cookieNonce: req.cookies.get(GOOGLE_STATE_COOKIE)?.value,
    userId: user?.id,
    secret,
  })
  if (!check.ok) return back(check.reason === "expired" ? "expired" : "forbidden")
  // Single use: claim the nonce once (atomic, cap 1). A replay of this exact
  // callback, cookie and all, finds it claimed; a counter error refuses too
  // (bumpCounter fails closed). The counter lives with the logins in the
  // control project, which every deployment can reach.
  if (!(await bumpCounter(createControlServiceClient(), GOOGLE_NONCE_SCOPE, nonceKey(check.nonce), 1))) {
    return back("forbidden")
  }
  const sessionId = check.sessionId

  // Never store a token for a session whose data this deployment does not own.
  if (!routeSession(sessionId).served) return back("unavailable")
  // Access may have changed since the flow started (membership removed), so
  // re-check that this caller may still open the session.
  const access = await checkOnboardingAccess(req, sessionId)
  if (!access.ok || access.access === "demo") return back("forbidden")
  const practice = await practiceStatus(createServiceClient(), sessionId)
  if (!practice.ok) return back("unavailable")
  if (practice.isPractice) return back("practice")

  // Exchange the authorization code for tokens.
  let refreshToken: string | null = null
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    })

    if (!tokenRes.ok) {
      // Do not log the response body; it can carry sensitive material.
      return back("token_exchange_failed")
    }

    const tokens = (await tokenRes.json()) as {
      refresh_token?: string
      access_token?: string
    }
    // Refresh token is what we persist server-side; access tokens are ephemeral
    // and we do not store them.
    refreshToken =
      typeof tokens.refresh_token === "string" ? tokens.refresh_token : null
  } catch {
    return back("token_exchange_error")
  }

  // Persist the connection on the verified session + flip the capability live.
  // A session row that has gone missing is not fatal; the user still
  // authenticated, so just redirect back cleanly.
  if (sessionId) {
    try {
      const supabase = createServiceClient()

      const { data: session } = await supabase
        .from("onboarding_sessions")
        .select("collected, contact_id")
        .eq("id", sessionId)
        .maybeSingle()

      if (session) {
        const current =
          session.collected && typeof session.collected === "object"
            ? (session.collected as Record<string, unknown>)
            : {}

        // The `google_connected` boolean is safe to expose to the UI; it stays
        // in `collected`. The refresh token does NOT — the session GET returns
        // the whole `collected` blob to the browser, and a column-level select
        // whitelist cannot exclude a nested JSONB key. So the token goes into
        // its own top-level `google_token_ref` column, which is NOT in the
        // GET's CLIENT_FIELDS and therefore never reaches the browser.
        const nextCollected: Record<string, unknown> = {
          ...current,
          google_connected: true,
        }

        const update: Record<string, unknown> = {
          collected: nextCollected,
          updated_at: new Date().toISOString(),
        }
        // Persist the refresh token in the server-only column, never in
        // `collected`. Do not log it.
        if (refreshToken) update.google_token_ref = refreshToken

        await supabase
          .from("onboarding_sessions")
          .update(update)
          .eq("id", sessionId)

        // Flip gbp_reviews live for the linked contact, if provisioning already
        // seeded it. onConflict updates status without duplicating.
        if (session.contact_id) {
          await supabase
            .from("client_capabilities")
            .upsert(
              {
                contact_id: session.contact_id,
                capability_key: "gbp_reviews",
                label: "Google reviews + responses",
                status: "live",
              },
              { onConflict: "contact_id,capability_key" }
            )
        }

        // First calendar pull, right now. syncSessionCalendar never throws
        // (every failure comes back as a result row) and the token is passed
        // in-memory rather than re-read. Bounded by a timeout race so a slow
        // Google can never hold the user on this redirect; the daily cron
        // (/api/calendar/sync) picks up anything this pull misses.
        if (refreshToken) {
          let timer: ReturnType<typeof setTimeout> | undefined
          await Promise.race([
            syncSessionCalendar(sessionId, refreshToken),
            new Promise((resolve) => {
              timer = setTimeout(resolve, FIRST_SYNC_TIMEOUT_MS)
            }),
          ])
          // Do not leave the timer holding the function alive after the race.
          if (timer) clearTimeout(timer)
        }
      }
    } catch {
      // Persistence hiccup; the user still connected. Redirect cleanly and let
      // the completion route re-seed capabilities regardless.
      return back("connected")
    }
  }

  return back("connected")
}
