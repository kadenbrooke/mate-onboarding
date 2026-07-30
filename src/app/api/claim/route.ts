// Authed user enters an access code POST-login to unlock their real client
// dashboard. Claim is atomic and single-use (claimCode). On any membership
// failure the code is released so it is not burned.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeCode } from "@/lib/portal/access-code";
import { claimCode, unclaimCode, attachMembership } from "@/lib/portal/provision";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const code = normalizeCode(body?.code ?? "");
  if (!code) {
    return NextResponse.json({ error: "That access code does not look right." }, { status: 400 });
  }

  const claimed = await claimCode(code);
  if (!claimed) {
    return NextResponse.json(
      { error: "That code is not valid. Check it, or ask us for a fresh one." },
      { status: 400 }
    );
  }

  const result = await attachMembership({
    code,
    userId: user.id,
    email: user.email ?? "",
    claimedSessionId: claimed.sessionId,
  });
  if ("error" in result) {
    await unclaimCode(code);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ sessionId: result.sessionId });
}
