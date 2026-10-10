// src/app/postlogin/page.tsx
// Post-sign-in router. Every authenticated visitor lands somewhere; there is no
// "stranger" branch anymore (auth is open). Order of precedence:
//   1. claimed-code membership -> their real dashboard
//   2. internal staff (portal_access, client_slug=mate) -> app shell
//   3. waitlisted -> the shared demo dashboard
//   4. brand new -> /claim (enter a code, or join the waitlist)
// On a dedicated data-project deployment (lib/supabase/tenancy) only the served
// sessions count: memberships elsewhere are ignored, internal staff land on the
// served dashboard, and there is no demo, waitlist or claim to fall back on.
// A DB error on any lookup is not evidence about the user; keep the session and
// send them to /login?error=retry to try again (never sign out).
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createControlServiceClient } from "@/lib/supabase/service";
import { readTenancy } from "@/lib/supabase/tenancy";
import { DEMO_SESSION_ID } from "@/lib/portal/demo";

export const dynamic = "force-dynamic";

export default async function PostLogin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenancy = readTenancy();
  const dedicated = tenancy.mode === "dedicated";
  // Logins, memberships and the waitlist all live in the control project.
  const service = createControlServiceClient();

  const memberQuery = service
    .from("portal_members")
    .select("session_id")
    .eq("user_id", user.id);
  const { data: member, error: memberError } = await (dedicated
    ? memberQuery.in("session_id", [...tenancy.sessions])
    : memberQuery)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (memberError) redirect("/login?error=retry");
  if (member) redirect(`/dash/${member.session_id}`);

  const { data: internal, error: internalError } = await service
    .from("portal_access")
    .select("client_slug")
    .eq("email", user.email ?? "")
    .eq("client_slug", "mate")
    .maybeSingle();
  if (internalError) redirect("/login?error=retry");
  if (internal) redirect(dedicated ? `/dash/${tenancy.sessions[0]}` : "/");
  if (dedicated) redirect("/login?error=unauthorized");

  const { data: waitlisted, error: waitlistError } = await service
    .from("portal_waitlist")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (waitlistError) redirect("/login?error=retry");
  if (waitlisted) redirect(`/dash/${DEMO_SESSION_ID}`);

  redirect("/claim");
}
