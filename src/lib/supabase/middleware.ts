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
  // /onboard (pre-auth concierge), /portal (client POC), and /dash (client
  // dashboard) are client-facing surfaces for people who do not have an
  // internal login. All three are session-scoped by an unguessable UUID and
  // use the service client internally, so middleware auth is redundant.
  // Phase-2 hardening: bind a signed session cookie to /dash and /portal.
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/") ||
    path.startsWith("/onboard") ||
    path.startsWith("/portal") ||
    path.startsWith("/dash");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
