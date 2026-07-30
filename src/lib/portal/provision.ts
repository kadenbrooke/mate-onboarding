// Shared server-side portal provisioning. Both the password signup route and
// the Google OAuth callback need the same three moves: atomically claim a
// single-use access code, create (or reuse) the onboarding session, and insert
// the portal_members row. Extracted here so the two paths cannot drift.
//
// Ownership split: the CALLER owns unclaiming the code and deleting any auth
// user it created. attachMembership only cleans up a session IT created here.
import { createServiceClient } from "@/lib/supabase/service";

type ClaimResult = { code: string; sessionId: string | null };

/**
 * Atomic single-use claim. Stamps claimed_at only (the claimant's email is not
 * always known at claim time (the OAuth path learns it after the redirect), so
 * claimed_by_email is set later in attachMembership. Returns null when the code
 * is missing, already claimed, or expired.
 */
export async function claimCode(code: string): Promise<ClaimResult | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("portal_codes")
    .update({ claimed_at: new Date().toISOString() })
    .eq("code", code)
    .is("claimed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("code, session_id")
    .maybeSingle();
  return data ? { code: data.code, sessionId: data.session_id ?? null } : null;
}

/** Release a claim so a failed signup does not burn a single-use code. */
export async function unclaimCode(code: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("portal_codes")
    .update({ claimed_at: null, claimed_by_email: null })
    .eq("code", code);
}

/**
 * After a user exists (password OR Google) and their code is claimed, stamp the
 * claimant email on the code, create the onboarding session (unless the code
 * pre-linked one), and insert the membership row. On member-insert failure a
 * session created HERE is deleted and an error is returned; the caller owns
 * unclaiming and any auth-user deletion.
 */
export async function attachMembership(args: {
  code: string;
  userId: string;
  email: string;
  claimedSessionId: string | null;
}): Promise<{ sessionId: string } | { error: string }> {
  const supabase = createServiceClient();
  const emailLower = args.email.toLowerCase();

  // Record who claimed the code (deferred from claimCode for the OAuth path).
  await supabase
    .from("portal_codes")
    .update({ claimed_by_email: emailLower })
    .eq("code", args.code);

  const createdSession = !args.claimedSessionId;
  let sessionId: string;
  if (args.claimedSessionId) {
    sessionId = args.claimedSessionId;
  } else {
    const now = new Date().toISOString();
    const { data: session, error } = await supabase
      .from("onboarding_sessions")
      .insert({ step: "website", status: "in_progress", created_at: now, updated_at: now })
      .select("id")
      .single();
    if (error || !session) return { error: "Could not start onboarding." };
    sessionId = session.id;
  }

  const { error: memberErr } = await supabase.from("portal_members").insert({
    user_id: args.userId,
    email: emailLower,
    session_id: sessionId,
    role: "owner",
  });
  if (memberErr) {
    if (createdSession) {
      await supabase
        .from("onboarding_sessions")
        .delete()
        .eq("id", sessionId)
        .then(() => undefined, () => undefined);
    }
    return { error: "Could not finish account setup." };
  }
  return { sessionId };
}
