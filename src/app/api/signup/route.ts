// Open self-serve signup. No access code. Creates an instant-confirmed auth
// user (project mailer_autoconfirm is off, so admin create is how self-serve
// users get immediate access). Membership/waitlist attachment happens later at
// /claim or /waitlist, post-login.
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateSignupInput, type SignupInput } from "@/lib/portal/signup-validation";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as SignupInput | null;
  const invalid = validateSignupInput(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { email, password } = body!;

  const supabase = createServiceClient();
  const { data: created, error: userErr } = await supabase.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: true,
  });
  if (userErr || !created?.user) {
    const exists = userErr?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      {
        error: exists
          ? "An account with that email already exists. Log in instead."
          : "Could not create the account. Try again.",
      },
      { status: exists ? 409 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
