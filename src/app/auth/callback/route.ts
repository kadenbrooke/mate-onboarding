// Google OAuth callback. Runs as a route handler so the Supabase SSR client can
// WRITE the session cookies (a Server Component cannot). Exchanges the OAuth
// code for a session, then always hands off to /postlogin, which routes by role
// (member -> dash, internal -> app shell, waitlisted -> demo, new -> /claim).
import { publicRedirect } from "@/lib/public-url";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const oauthErr = url.searchParams.get("error");
  if (oauthErr) return publicRedirect("/login?error=oauth", req);

  const oauthCode = url.searchParams.get("code");
  // No error and no code = a malformed callback or a direct hit. Treat as a
  // failed sign-in rather than falling through to the getUser path.
  if (!oauthCode) return publicRedirect("/login?error=oauth", req);

  const supabase = await createClient();
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(oauthCode);
  if (exchangeErr) return publicRedirect("/login?error=oauth", req);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return publicRedirect("/login?error=retry", req);

  return publicRedirect("/postlogin", req);
}
