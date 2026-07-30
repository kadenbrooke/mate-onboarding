// src/app/postlogin/page.tsx
// Post-sign-in router. Every authenticated visitor lands somewhere; there is no
// "stranger" branch anymore (auth is open). Order of precedence:
//   1. claimed-code membership -> their real dashboard
//   2. internal staff (portal_access, client_slug=mate) -> app shell
//   3. waitlisted -> the shared demo dashboard
//   4. brand new -> /claim (enter a code, or join the waitlist)
// A DB error on any lookup is not evidence about the user; keep the session and
// send them to /login?error=retry to try again (never sign out).
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { DEMO_SESSION_ID } from "@/lib/portal/demo";

export const dynamic = "force-dynamic";

export default async function PostLogin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const service = createServiceClient();

  const { data: member, error: memberError } = await service
    .from("portal_members")
    .select("session_id")
    .eq("user_id", user.id)
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
  if (internal) redirect("/");

  const { data: waitlisted, error: waitlistError } = await service
    .from("portal_waitlist")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (waitlistError) redirect("/login?error=retry");
  if (waitlisted) redirect(`/dash/${DEMO_SESSION_ID}`);

  redirect("/claim");
}
