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
  // /portal (client POC) and /dash (client dashboard) stay in the public list:
  // /dash gating needs a DB read (is_demo) so it lives in the dash pages via
  // requireDashAccess(); /portal is legacy and migrates in Plan 3. /onboard is
  // no longer public: onboarding is a post-signup surface for claimed accounts.
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/") ||
    path.startsWith("/portal") ||
    path.startsWith("/dash") ||
    // /demo is the public Instant First Responder Demo lander (prospect-facing,
    // no login). Session-scoped by an unguessable UUID + caller-ID join key.
    // L1: exact-match "/demo" or a "/demo/" child only, so a look-alike prefix
    // like "/demonstrate-admin" can't slip past the auth gate.
    path === "/demo" ||
    path.startsWith("/demo/");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
