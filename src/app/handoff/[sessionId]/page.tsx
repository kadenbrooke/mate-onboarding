import { redirect } from "next/navigation";
import {
  Buildings,
  User,
  Phone,
  Wrench,
  ChatCircleText,
  PlugsConnected,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildBrief, NOT_PROVIDED, type BriefGroup } from "@/lib/handoff/brief";
import CopyButton from "./CopyButton";

/**
 * Internal handoff brief — the ONE Kaden-facing surface in this app.
 *
 * After a client finishes onboarding, this page renders their collected data as
 * a buildable First Responder brief (Phase 1 = manual n8n / Telnyx build off
 * this data), plus a copy-ready plain-text block.
 *
 * AUTH (defense in depth). Unlike /onboard and /portal (public, session-scoped
 * client surfaces), /handoff is internal:
 *   1. Middleware already redirects any anonymous request to a non-public path
 *      (/handoff is not on the public list) to /login.
 *   2. This page ALSO verifies server-side, reusing the exact (app)/layout gate:
 *      getUser() -> redirect /login if unauthenticated; then require a
 *      portal_access row for the internal allowlist slug -> otherwise sign out +
 *      redirect. Client data is never rendered to an unauthenticated or
 *      non-allowlisted user.
 *
 * The session load uses the SERVICE-ROLE client (server-side only, created
 * inside this component) to bypass RLS, mirroring the API routes.
 */

// Same internal allowlist slug the (app) layout gates on. An internal user with
// a portal_access row for this slug is authorized to see the handoff brief.
const INTERNAL_SLUG = "mate";

// Phosphor icon per group title, so the render stays declarative.
const GROUP_ICONS: Record<string, React.ReactNode> = {
  Business: <Buildings className="h-4 w-4" weight="fill" />,
  Contact: <User className="h-4 w-4" weight="fill" />,
  "Phone & forwarding": <Phone className="h-4 w-4" weight="fill" />,
  Services: <Wrench className="h-4 w-4" weight="fill" />,
  "Voice & qualify": <ChatCircleText className="h-4 w-4" weight="fill" />,
  Integrations: <PlugsConnected className="h-4 w-4" weight="fill" />,
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#141414] text-[#ede6e6]">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">{children}</div>
    </main>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  const missing = value === NOT_PROVIDED;
  return (
    <div className="flex flex-col gap-0.5 border-b border-[#242424] py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-52 shrink-0 text-xs uppercase tracking-wide text-[#888]">{label}</span>
      <span className={`text-sm ${missing ? "italic text-[#666]" : "text-[#ede6e6]"}`}>{value}</span>
    </div>
  );
}

function Group({ group }: { group: BriefGroup }) {
  return (
    <section className="rounded-xl border border-[#2a2a2a] bg-[#181818] p-4 md:p-5">
      <div className="mb-2 flex items-center gap-2 text-[#e14d1a]">
        {GROUP_ICONS[group.title] ?? null}
        <h2
          className="text-sm font-bold text-[#ede6e6]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {group.title}
        </h2>
      </div>
      <div>
        {group.fields.map((f) => (
          <FieldRow key={f.label} label={f.label} value={f.value} />
        ))}
      </div>
    </section>
  );
}

export default async function HandoffPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  // --- Gate (reuses (app)/layout.tsx pattern) -----------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: access } = await supabase
    .from("portal_access")
    .select("client_slug")
    .eq("email", user.email ?? "")
    .eq("client_slug", INTERNAL_SLUG)
    .maybeSingle();

  if (!access) {
    // Authenticated but not on the internal allowlist. Never render client data.
    await supabase.auth.signOut();
    redirect("/login?error=unauthorized");
  }
  // ------------------------------------------------------------------------

  // Load the session server-side with the service-role client (bypasses RLS).
  // Created inside the component so `next build` never needs the secret.
  const service = createServiceClient();
  const { data: session, error } = await service
    .from("onboarding_sessions")
    .select("id, mate_name, website_url, status, collected")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !session) {
    return (
      <Shell>
        <div className="flex items-start gap-2 rounded-xl border border-[#3a2a1a] bg-[#1c1712] p-4 text-[#f5a97f]">
          <Warning className="mt-0.5 h-5 w-5 shrink-0" weight="fill" />
          <div>
            <p className="text-sm font-semibold">Session not found</p>
            <p className="mt-1 text-xs text-[#c9a15f]">
              No onboarding session matches this id. Check the link or confirm the
              client has started onboarding.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  const brief = buildBrief(session);

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-[#888]">First Responder build brief</p>
        <h1
          className="mt-1 text-2xl font-bold text-[#ede6e6]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {brief.heading}
        </h1>
        <p className="mt-1 text-xs text-[#666]">
          Session {session.id}
          {session.status ? ` · ${session.status}` : ""}
        </p>
      </header>

      <div className="grid gap-3">
        {brief.groups.map((g) => (
          <Group key={g.title} group={g} />
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-[#2a2a2a] bg-[#181818] p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2
            className="text-sm font-bold text-[#ede6e6]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Copy-ready brief
          </h2>
          <CopyButton text={brief.copyText} />
        </div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#242424] bg-[#0f0f0f] p-3 font-mono text-xs leading-relaxed text-[#c4bebe]">
          {brief.copyText}
        </pre>
      </section>
    </Shell>
  );
}
