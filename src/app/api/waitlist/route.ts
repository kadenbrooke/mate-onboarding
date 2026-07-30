// Authed user joins the waitlist. Creates (or reuses) a CRM lead, upserts the
// portal_waitlist row (grants the shared demo dashboard), and fires a best-effort
// founder nudge. A nudge or CRM-insert failure never fails the request.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { business_name?: string; phone?: string; website?: string }
    | null;
  const businessName = body?.business_name?.trim();
  if (!businessName) {
    return NextResponse.json({ error: "Tell us your business name." }, { status: 400 });
  }
  const phone = body?.phone ?? null;
  const website = body?.website ?? null;

  const service = createServiceClient();

  // Reuse the CRM lead from an existing waitlist row if the user already joined.
  const { data: existing } = await service
    .from("portal_waitlist")
    .select("contact_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let contactId: string | null = existing?.contact_id ?? null;
  if (!existing) {
    const { data: contact } = await service
      .from("contacts")
      .insert({
        name: businessName,
        company: businessName,
        email: user.email,
        phone,
        lifecycle: "lead",
        source: "portal-waitlist",
        interest_level: "warm",
        next_follow_up_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    contactId = contact?.id ?? null;
  }

  await service
    .from("portal_waitlist")
    .upsert(
      {
        user_id: user.id,
        email: user.email,
        business_name: businessName,
        phone,
        website,
        contact_id: contactId,
      },
      { onConflict: "user_id" }
    );

  // Best-effort founder nudge; never fail the request on a nudge error.
  await service
    .from("nudges")
    .insert({
      nudge_type: "portal_waitlist",
      message: `New portal waitlist: ${businessName} (${user.email})`,
      contact_id: contactId,
    })
    .then(() => undefined, () => undefined);

  return NextResponse.json({ ok: true });
}
