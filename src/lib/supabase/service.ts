import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for TRUSTED server-side API routes only.
 *
 * Uses the current-pattern secret key (`sb_secret_...`) which bypasses RLS, so
 * these routes can read/write the onboarding tables that have RLS enabled with
 * no anon policies. NEVER import this from client components or the auth-gated
 * (app) pages — the browser must never touch this key.
 *
 * The key is read from process.env INSIDE the function (never at module scope)
 * so `next build` does not require the secret to be present at build time.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase service client missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY"
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
