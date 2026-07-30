import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOut } from "@phosphor-icons/react/dist/ssr";

// Placeholder client slug for the membership gate. A later task derives this
// per-tenant from the onboarding session; the auth scaffold is kept intact here.
const CLIENT_SLUG = "mate";

async function signOutAction() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Membership gate: the signed-in user must have portal access for THIS client.
  const { data: access } = await supabase
    .from("portal_access")
    .select("client_slug")
    .eq("email", user.email ?? "")
    .eq("client_slug", CLIENT_SLUG)
    .maybeSingle();

  // No portal_access here does NOT mean stranger: portal members (clients)
  // belong on their dash, not this internal shell. /postlogin re-routes them
  // there and sends true strangers to /auth/signout for a real cookie-clearing
  // sign-out (signOut() in a Server Component cannot write cookies). No loop:
  // strangers never get redirected back to "/".
  if (!access) {
    redirect("/postlogin");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[#333] px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-sm font-bold text-[#ede6e6] shrink-0"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Mate
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-[#888] hidden md:block max-w-[180px] truncate">{user.email}</span>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              className="flex items-center gap-1.5 text-xs text-[#888] hover:text-[#ede6e6] transition-colors py-1"
            >
              <SignOut className="w-4 h-4" /> <span className="hidden sm:inline">sign out</span>
            </button>
          </form>
        </div>
      </header>
      <main className="px-4 py-4 md:p-6 max-w-5xl mx-auto">{children}</main>
    </div>
  );
}
