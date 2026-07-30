// Google-signup pre-check. Validates that an access code is claimable WITHOUT
// consuming it, then stashes it (HMAC-signed, httpOnly) so /auth/callback can
// do the real single-use claim after Google returns. Consuming the code here
// would burn it if the user abandoned the OAuth consent screen.
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeCode } from "@/lib/portal/access-code";
import { PENDING_CODE_COOKIE, signPendingCode } from "@/lib/portal/pending-code";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const code = normalizeCode(body?.code ?? "");
  if (!code) {
    return NextResponse.json({ error: "That access code does not look right." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("portal_codes")
    .select("code")
    .eq("code", code)
    .is("claimed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) {
    return NextResponse.json(
      { error: "That code is not valid. Check it, or ask us for a fresh one." },
      { status: 400 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PENDING_CODE_COOKIE, signPendingCode(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
