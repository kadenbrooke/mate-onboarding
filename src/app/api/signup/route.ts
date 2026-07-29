import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeCode } from "@/lib/portal/access-code";
import { validateSignupInput, type SignupInput } from "@/lib/portal/signup-validation";
import { claimCode, unclaimCode, attachMembership } from "@/lib/portal/provision";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as SignupInput | null;
  const invalid = validateSignupInput(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { email, password } = body!;
  const code = normalizeCode(body!.code)!;

  // Claim FIRST (before createUser) so a caller cannot use this route to probe
  // which emails already have accounts: an invalid code fails before any auth
  // lookup happens.
  const claimed = await claimCode(code);
  if (!claimed) {
    return NextResponse.json(
      { error: "That code is not valid. Check it, or ask us for a fresh one." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Invited clients skip the confirmation email: the access code IS the invite.
  const { data: created, error: userErr } = await supabase.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: true,
  });
  if (userErr || !created?.user) {
    await unclaimCode(code);
    const exists = userErr?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      { error: exists ? "An account with that email already exists. Log in instead." : "Could not create the account. Try again." },
      { status: exists ? 409 : 500 }
    );
  }

  const res = await attachMembership({
    code,
    userId: created.user.id,
    email,
    claimedSessionId: claimed.sessionId,
  });
  if ("error" in res) {
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    await unclaimCode(code);
    return NextResponse.json({ error: res.error }, { status: 500 });
  }

  return NextResponse.json({ sessionId: res.sessionId });
}
