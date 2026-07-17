import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/connect/google?sessionId=... : start the Google Business OAuth flow.
 *
 * SCAFFOLD ONLY. Google Business Profile API access requires Google approval we
 * do NOT have, so this route builds the consent URL and hands off the callback;
 * it never calls the GBP data API. `business.manage` is requested but a denial
 * is tolerated (the account stays Under Construction).
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
  // Requested but optional; GBP access is gated on Google approval we lack.
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
