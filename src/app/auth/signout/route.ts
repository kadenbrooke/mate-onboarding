// Clears the Supabase session cookies then bounces to login. Exists because
// signOut() inside a Server Component cannot write cookies (read-only store),
// so redirect-to-here is the only reliable sign-out from RSC code paths.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );
  await supabase.auth.signOut();
  const url = new URL(req.url);
  const reason = url.searchParams.get("reason") === "retry" ? "retry" : "unauthorized";
  return NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin), { status: 303 });
}
