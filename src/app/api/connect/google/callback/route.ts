import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

/**
 * GET /api/connect/google/callback: Google OAuth redirect target.
 *
 * SCAFFOLD ONLY. Exchanges the `code` for tokens at Google's token endpoint and
 * records that the connection succeeded. It does NOT call the GBP data API
 * (access gated on Google approval we lack). The refresh token is stored
 * server-side on the session (`collected.google_token_ref`) and NEVER returned
 * to the browser or logged.
 *
 * Any error or missing config redirects back to /onboard with a soft
 * `?google=<reason>` param; we never 500 the user mid-onboarding.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

function backToOnboard(req: NextRequest, status: string): NextResponse {
  const url = new URL("/onboard", req.nextUrl.origin)
  url.searchParams.set("google", status)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI

  // Not configured: treat as a soft "connect later", never crash.
  if (!clientId || !clientSecret || !redirectUri) {
    return backToOnboard(req, "unconfigured")
  }

  // Google returns ?error=access_denied when the user declines. Tolerate it.
  const error = req.nextUrl.searchParams.get("error")
  if (error) {
    return backToOnboard(req, "denied")
  }

  const code = req.nextUrl.searchParams.get("code")
  const sessionId = req.nextUrl.searchParams.get("state") ?? ""
  if (!code) {
    return backToOnboard(req, "missing_code")
  }

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
      return backToOnboard(req, "token_exchange_failed")
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
    return backToOnboard(req, "token_exchange_error")
  }

  // Persist the connection on the session + flip the capability live, if we can
  // resolve the session. A missing session id is not fatal; the user still
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

        const nextCollected: Record<string, unknown> = {
          ...current,
          google_connected: true,
        }
        // Store the refresh token server-side, associated with the session.
        // Never exposed to the browser (the session GET whitelist excludes it).
        if (refreshToken) nextCollected.google_token_ref = refreshToken

        await supabase
          .from("onboarding_sessions")
          .update({
            collected: nextCollected,
            updated_at: new Date().toISOString(),
          })
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
      }
    } catch {
      // Persistence hiccup; the user still connected. Redirect cleanly and let
      // the completion route re-seed capabilities regardless.
      return backToOnboard(req, "connected")
    }
  }

  return backToOnboard(req, "connected")
}
