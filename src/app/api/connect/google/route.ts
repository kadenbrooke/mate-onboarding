import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/connect/google?sessionId=... : start the Google OAuth flow.
 *
 * This is the real connection behind the Calendar zone: `calendar.readonly` is
 * the scope that matters, and the callback's first sync plus the daily cron
 * (/api/calendar/sync) turn the client's `primary` calendar into the booked
 * jobs on their dashboard.
 *
 * `business.manage` is still requested for Google Business Profile (reviews),
 * but GBP data access is gated on Google approval we do NOT have, so a denial
 * of that one scope is tolerated -- the reputation zone stays Under
 * Construction while the calendar works.
 *
 * If the OAuth env is not fully configured, we return `{ configured: false }`
 * (HTTP 200) so the UI can show "connect later" and the capability stays Under
 * Construction. We never crash the flow.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const SCOPES = [
  "openid",
  "email",
  "profile",
  // The calendar read scope: this is what the Calendar zone actually needs.
  "https://www.googleapis.com/auth/calendar.readonly",
  // Requested but optional; GBP access is gated on Google approval we lack, so
  // a denial here must not break the calendar connection.
  "https://www.googleapis.com/auth/business.manage",
].join(" ")

export async function GET(req: NextRequest) {
  // Read env INSIDE the handler so an unset config can't throw at module load.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ configured: false })
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? ""

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline", // request a refresh token
    prompt: "consent",
    include_granted_scopes: "true",
    // Pass the session id through so the callback can resolve which onboarding
    // this consent belongs to.
    state: sessionId,
  })

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`)
}
