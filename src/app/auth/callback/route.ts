// Google OAuth callback. Runs as a route handler so the Supabase SSR client can
// WRITE the session cookies (a Server Component cannot). Exchanges the OAuth
// code for a session, then:
//   - pending signup code present -> claim it + attach membership -> /onboard
//   - no pending code (plain login) -> /postlogin (which routes by role)
// The pending cookie is HMAC-signed by /api/signup/reserve, so a stale/injected
// value cannot bind a code on a plain login.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { PENDING_CODE_COOKIE, verifyPendingCode } from "@/lib/portal/pending-code";
import { claimCode, unclaimCode, attachMembership } from "@/lib/portal/provision";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const oauthErr = url.searchParams.get("error");
  if (oauthErr) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));

  const oauthCode = url.searchParams.get("code");
  const supabase = await createClient();
  if (oauthCode) {
    const { error } = await supabase.auth.exchangeCodeForSession(oauthCode);
    if (error) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?error=retry", url.origin));

  const cookieStore = await cookies();
  const pending = verifyPendingCode(cookieStore.get(PENDING_CODE_COOKIE)?.value);
  if (pending) {
    // Claim now (post-OAuth). Consume the pending cookie no matter the outcome.
    const claimed = await claimCode(pending);
    if (!claimed) {
      const res = NextResponse.redirect(new URL("/auth/signout?reason=unauthorized", url.origin));
      res.cookies.delete(PENDING_CODE_COOKIE);
      return res;
    }
    const result = await attachMembership({
      code: pending,
      userId: user.id,
      email: user.email ?? "",
      claimedSessionId: claimed.sessionId,
    });
    const res = NextResponse.redirect(
      "error" in result
        ? new URL("/auth/signout?reason=retry", url.origin)
        : new URL(`/onboard?session=${result.sessionId}`, url.origin)
    );
    res.cookies.delete(PENDING_CODE_COOKIE);
    if ("error" in result) await unclaimCode(pending);
    return res;
  }

  return NextResponse.redirect(new URL("/postlogin", url.origin));
}
