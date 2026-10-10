import { createClient } from "@supabase/supabase-js";
import { readTenancy } from "./tenancy";

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
 *
 * This is the DATA client (leads, conversations, zone tables,
 * onboarding_sessions). On a dedicated deployment (SUPABASE_DATA_URL +
 * SUPABASE_DATA_SECRET_KEY + MATE_DATA_SESSION_IDS, see ./tenancy) it points at
 * that client's own project. With those unset it is the shared project, exactly
 * as before. Logins, portal membership and our CRM always go through
 * createControlServiceClient instead.
 */
export function createServiceClient() {
  const tenancy = readTenancy();
  if (tenancy.mode === "dedicated") {
    return createClient(tenancy.dataUrl, tenancy.dataKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return createControlServiceClient();
}

/**
 * Service-role client for the CONTROL project, whatever this deployment's data
 * project is: auth admin, portal_members, portal_access, portal_codes,
 * portal_waitlist, and our CRM tables (contacts, contact_materials, nudges).
 * The portal logins live in this project's auth.users, so membership is always
 * read here.
 */
export function createControlServiceClient() {
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
