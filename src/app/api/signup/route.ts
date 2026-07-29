import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeCode } from "@/lib/portal/access-code";
import { validateSignupInput, type SignupInput } from "@/lib/portal/signup-validation";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as SignupInput | null;
  const invalid = validateSignupInput(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { email, password } = body!;
  const code = normalizeCode(body!.code)!;
  const supabase = createServiceClient();

  // Atomic single-use claim. No row back = missing, already claimed, or expired.
  const { data: claimed } = await supabase
    .from("portal_codes")
    .update({ claimed_by_email: email.toLowerCase(), claimed_at: new Date().toISOString() })
    .eq("code", code)
    .is("claimed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("code, session_id")
    .maybeSingle();
  if (!claimed) {
    return NextResponse.json(
      { error: "That code is not valid. Check it, or ask us for a fresh one." },
      { status: 400 }
    );
  }

  const unclaim = () =>
    supabase
      .from("portal_codes")
      .update({ claimed_by_email: null, claimed_at: null })
      .eq("code", code)
      .then(() => undefined);

  // Invited clients skip the confirmation email: the access code IS the invite.
  const { data: created, error: userErr } = await supabase.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: true,
  });
  if (userErr || !created?.user) {
    await unclaim();
    const exists = userErr?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      { error: exists ? "An account with that email already exists. Log in instead." : "Could not create the account. Try again." },
      { status: exists ? 409 : 500 }
    );
  }

  let sessionId = claimed.session_id as string | null;
  if (!sessionId) {
    const now = new Date().toISOString();
    const { data: session, error: sessionErr } = await supabase
      .from("onboarding_sessions")
      .insert({ step: "website", status: "in_progress", created_at: now, updated_at: now })
      .select("id")
      .single();
    if (sessionErr || !session) {
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      await unclaim();
      return NextResponse.json({ error: "Could not start onboarding. Try again." }, { status: 500 });
    }
    sessionId = session.id;
  }

  const { error: memberErr } = await supabase.from("portal_members").insert({
    user_id: created.user.id,
    email: email.toLowerCase(),
    session_id: sessionId,
    role: "owner",
  });
  if (memberErr) {
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    await unclaim();
    return NextResponse.json({ error: "Could not finish account setup. Try again." }, { status: 500 });
  }

  return NextResponse.json({ sessionId });
}
