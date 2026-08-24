// Server-side dash gate. Call at the TOP of every /dash page (pages, not just
// the layout: layout-only auth is bypassable in Next). Redirects or 404s on
// deny; returns the access mode on allow.
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveDashAccess, type DashAccess } from "./dash-access";
import { resolveSessionId } from "./demo";

/**
 * Resolve the caller's access to a dash session WITHOUT acting on it.
 *
 * Same decision as requireDashAccess, minus the notFound()/redirect() — those
 * throw, which is right for a page and wrong for an API route (a thrown
 * NEXT_REDIRECT inside a route handler surfaces as a 500, not a 401). API
 * routes call this and map the verdict onto status codes; pages call
 * requireDashAccess, which is this plus the throws.
 */
export async function checkDashAccess(rawSessionId: string): Promise<DashAccess> {
  // Map the "demo" alias to the real demo UUID before any DB read / redirect,
  // so /dash/demo is gated exactly like /dash/<demo-uuid> (public, is_demo).
  const sessionId = resolveSessionId(rawSessionId);
  const service = createServiceClient();
  const { data: session } = await service
    .from("onboarding_sessions")
    .select("id, is_demo")
    .eq("id", sessionId)
    .maybeSingle();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isMember = false;
  let isInternal = false;
  if (user && session && !session.is_demo) {
    const [memberRes, internalRes] = await Promise.all([
      service
        .from("portal_members")
        .select("role")
        .eq("user_id", user.id)
        .eq("session_id", sessionId)
        .maybeSingle(),
      service
        .from("portal_access")
        .select("client_slug")
        .eq("email", user.email ?? "")
        .eq("client_slug", "mate")
        .maybeSingle(),
    ]);
    isMember = !!memberRes.data;
    isInternal = !!internalRes.data;
  }

  return resolveDashAccess({
    sessionExists: !!session,
    isDemo: !!session?.is_demo,
    hasUser: !!user,
    isMember,
    isInternal,
  });
}

export async function requireDashAccess(rawSessionId: string): Promise<DashAccess> {
  const sessionId = resolveSessionId(rawSessionId);
  const access = await checkDashAccess(rawSessionId);

  if (access === "not-found") notFound();
  if (access === "login") redirect(`/login?next=${encodeURIComponent(`/dash/${sessionId}`)}`);
  if (access === "forbidden") redirect("/login?error=unauthorized");
  return access;
}
