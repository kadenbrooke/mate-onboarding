// src/app/postlogin/page.tsx
// Post-sign-in router: clients land on their dash, internal staff on the
// (app) shell, strangers get signed out. Not in the middleware public list,
// so an unauthenticated hit bounces to /login before this runs.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function PostLogin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const service = createServiceClient();
  const { data: member } = await service
    .from("portal_members")
    .select("session_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (member) redirect(`/dash/${member.session_id}`);

  const { data: internal } = await service
    .from("portal_access")
    .select("client_slug")
    .eq("email", user.email ?? "")
    .eq("client_slug", "mate")
    .maybeSingle();
  if (internal) redirect("/");

  await supabase.auth.signOut();
  redirect("/login?error=unauthorized");
}
