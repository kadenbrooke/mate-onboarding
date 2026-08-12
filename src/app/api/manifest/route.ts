/**
 * GET /api/manifest?session=<id> — per-session PWA manifest for a client dash.
 *
 * Why this route exists: Android Chrome builds a WebAPK from the manifest and
 * launches `start_url`, NOT the page the user was on when they tapped "Add to
 * Home screen". With one static manifest pinned at `/onboard`, every client who
 * installed from their dash got dropped on `/onboard` -> not in the proxy's
 * public list -> 307 to `/login`. (Jeffrey @ J&C, 2026-08-12.)
 *
 * So each dash serves its own manifest: `start_url` + `scope` + `id` are scoped
 * to that session, and the install lands exactly where it was made. The static
 * `public/manifest.json` stays as the fallback for non-dash surfaces.
 *
 * Auth: public by design. Chrome fetches the manifest without credentials, and
 * `/api/` is public in `src/proxy.ts`. The only thing this exposes beyond a
 * static manifest is the business name — already readable by anyone holding the
 * session UUID (which is the dash bearer today), so no new exposure surface.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveSessionId, DEMO_ALIAS, DEMO_SESSION_ID } from "@/lib/portal/demo";
import { BG_PAGE } from "@/lib/theme";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

/**
 * Business name for the installed app icon. White-label: the client sees their
 * own name, never "Auto Mate".
 *
 * Two sources, in order. `collected.company.name` is the onboarding-flow answer
 * and is empty for any client the founder provisioned directly (J&C's collected
 * is `{}`), so `contacts.company` via `contact_id` is the real-world fallback.
 * `mate_name` is deliberately NOT a source: it carries the assistant's name, not
 * the business ("Auto Mate AI Mate").
 *
 * Returns null on the shared public demo (stays generically "Mate", so the
 * prospect-facing sample install carries no Auto Mate branding — same policy as
 * the static manifest and the /demo lander) and on any read failure.
 */
async function resolveBusinessName(sessionId: string): Promise<string | null> {
  if (sessionId === DEMO_SESSION_ID) return null;
  try {
    const service = createServiceClient();
    const { data } = await service
      .from("onboarding_sessions")
      .select("collected, contact_id")
      .eq("id", sessionId)
      .maybeSingle();

    const collected = data?.collected as Record<string, unknown> | null;
    const company = collected?.company;
    if (company && typeof company === "object") {
      const name = (company as { name?: string }).name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }

    if (data?.contact_id) {
      const { data: contact } = await service
        .from("contacts")
        .select("company")
        .eq("id", data.contact_id)
        .maybeSingle();
      const contactCompany = contact?.company;
      if (typeof contactCompany === "string" && contactCompany.trim()) {
        return contactCompany.trim();
      }
    }
  } catch {
    // Non-fatal: a generic manifest still installs to the right start_url.
  }
  return null;
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("session") ?? "";

  // Only a real UUID or the "demo" alias may shape start_url/scope. Anything
  // else would let a caller point an install at an arbitrary path.
  if (raw !== DEMO_ALIAS && !UUID.test(raw)) {
    return NextResponse.json({ error: "invalid session" }, { status: 400 });
  }
  const sessionId = resolveSessionId(raw);

  const businessName = await resolveBusinessName(sessionId);

  // Keep the visible path on the alias the user actually opened, so a /dash/demo
  // install shows /dash/demo rather than the raw UUID.
  const base = `/dash/${raw}`;

  return NextResponse.json(
    {
      // Stable per-session identity so each client's install is its own app
      // instead of colliding with the generic "Mate" WebAPK.
      id: base,
      name: businessName ?? "Mate",
      // short_name is the home-screen label. Trim after slicing so a cut mid-gap
      // ("J&C Asphalt Paving" -> "J&C Asphalt ") doesn't ship a trailing space.
      short_name: businessName ? businessName.slice(0, 12).trim() : "Mate",
      description: "Your dashboard",
      start_url: base,
      scope: base,
      display: "standalone",
      // Dash shell is the light off-white canvas (2026-07 redesign), so the
      // splash/status bar match instead of flashing the dark onboarding shell.
      background_color: BG_PAGE,
      theme_color: BG_PAGE,
      icons: ICONS,
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}
