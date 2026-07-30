// Google OAuth callback. Runs as a route handler so the Supabase SSR client can
// WRITE the session cookies (a Server Component cannot). Exchanges the OAuth
// code for a session, then always hands off to /postlogin, which routes by role
// (member -> dash, internal -> app shell, waitlisted -> demo, new -> /claim).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const oauthErr = url.searchParams.get("error");
  if (oauthErr) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));

  const oauthCode = url.searchParams.get("code");
  // No error and no code = a malformed callback or a direct hit. Treat as a
  // failed sign-in rather than falling through to the getUser path.
  if (!oauthCode) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));

  const supabase = await createClient();
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(oauthCode);
  if (exchangeErr) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?error=retry", url.origin));

  return NextResponse.redirect(new URL("/postlogin", url.origin));
}
