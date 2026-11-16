import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { unservedSessionResponse } from "@/lib/supabase/tenant-response"
import { dataWritesEnabled } from "@/lib/supabase/write-gate"
import { practiceStatus } from "@/lib/portal/practice"
import { publicRedirect } from "@/lib/public-url"
import { pathSegment } from "@/lib/portal/safe-next"
import { checkOnboardingAccess } from "@/lib/portal/onboarding-gate"
import { createClient } from "@/lib/supabase/server"
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_TTL_MS,
  googleStateSecret,
  newGoogleNonce,
  signGoogleState,
} from "@/lib/portal/google-oauth-state"

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
 * `state` is signed (lib/portal/google-oauth-state): session id, a random nonce,
 * the signed-in user and a 10-minute expiry. The nonce also goes into an
 * httpOnly SameSite=Lax cookie, so the callback only finishes a flow this
 * browser started, for this session, as this user.
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

  // A connection always belongs to a session: the only caller (the dashboard's
  // Calendar lock, lib/dash/locks) always sends one.
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? ""
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })
  }
  // Connect from the deployment that owns this session's data (tenancy).
  const unserved = unservedSessionResponse(req, sessionId)
  if (unserved) return unserved
  // Read-only deployment (lib/supabase/write-gate): the token could not be stored.
  if (!dataWritesEnabled()) {
    return publicRedirect(`/dash/${pathSegment(sessionId)}?google=writes_disabled`, req)
  }
  // The callback stores a Google refresh token on this session and syncs that
  // calendar into it, so the caller must be allowed to open THIS session
  // (checkOnboardingAccess), and the public demo session never gets one.
  const access = await checkOnboardingAccess(req, sessionId)
  if (!access.ok || access.access === "demo") {
    return publicRedirect(`/dash/${pathSegment(sessionId)}?google=forbidden`, req)
  }
  const practice = await practiceStatus(createServiceClient(), sessionId)
  if (!practice.ok) {
    return publicRedirect(`/dash/${pathSegment(sessionId)}?google=unavailable`, req)
  }
  if (practice.isPractice) {
    return publicRedirect(`/dash/${pathSegment(sessionId)}?google=practice`, req)
  }

  // The user the callback must match. Every allowed non-demo caller is signed in.
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) {
    return publicRedirect(`/dash/${pathSegment(sessionId)}?google=forbidden`, req)
  }
  let secret: string
  try {
    secret = googleStateSecret()
  } catch {
    return publicRedirect(`/dash/${pathSegment(sessionId)}?google=unconfigured`, req)
  }
  const nonce = newGoogleNonce()
  const state = signGoogleState({ sessionId, nonce, userId: user.id, exp: Date.now() + GOOGLE_STATE_TTL_MS }, secret)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline", // request a refresh token
    prompt: "consent",
    include_granted_scopes: "true",
    // Signed: the callback verifies it, the cookie nonce, the user and the expiry.
    state,
  })

  const res = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`)
  res.cookies.set(GOOGLE_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // must survive the top-level redirect back from Google
    path: "/api/connect/google",
    maxAge: GOOGLE_STATE_TTL_MS / 1000,
  })
  return res
}
