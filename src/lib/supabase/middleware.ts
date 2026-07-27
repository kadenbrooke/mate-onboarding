import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session refresh + auth gate. Membership (portal_access for this client) is
// enforced in the app layout, which can run the authorated DB query. Here we
// only require that SOME authenticated session exists for non-public routes.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // /onboard (pre-auth concierge) and /portal (the client's ongoing POC) are
  // client-facing surfaces for people who do not have an internal login. Both are
  // session-scoped by an unguessable UUID, not by auth, so they must be public
  // alongside login/auth/api. Phase-2 hardening: bind a signed session cookie.
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/") ||
    path.startsWith("/onboard") ||
    path.startsWith("/portal") ||
    // /demo is the public Instant First Responder Demo lander (prospect-facing,
    // no login). Session-scoped by an unguessable UUID + caller-ID join key.
    // L1: exact-match "/demo" or a "/demo/" child only, so a look-alike prefix
    // like "/demonstrate-admin" can't slip past the auth gate.
    path === "/demo" ||
    path.startsWith("/demo/");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
