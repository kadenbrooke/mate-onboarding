"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GoogleLogo } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/portal/safe-next";

// Human-readable reasons for the ?error= codes the routing code redirects with.
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "That account does not have access.",
  retry: "Temporary problem. Try signing in again.",
  oauth: "Google sign-in did not complete. Try again.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Surface routing-supplied error reasons (?error=unauthorized|retry) after
  // mount. A useEffect keeps the SSR markup stable (no search-param read
  // during render, so no hydration mismatch or Suspense bailout).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code && ERROR_MESSAGES[code]) setError(ERROR_MESSAGES[code]);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // window.location (not useSearchParams) avoids the Suspense/CSR-bailout
    // requirement for search params in client pages.
    const raw = new URLSearchParams(window.location.search).get("next");
    const dest = safeNextPath(raw, window.location.origin) ?? "/postlogin";
    router.replace(dest);
    router.refresh();
  }

  async function onGoogle() {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError("Google sign-in did not complete. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="text-2xl font-bold text-[#ede6e6]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Mate
          </div>
          <div className="text-sm text-[#888] mt-3">onboarding</div>
        </div>

        <button
          type="button"
          onClick={onGoogle}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-[#1a1a1a] border border-[#333] hover:border-[#555] disabled:opacity-60 text-[#ede6e6] rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
        >
          <GoogleLogo size={18} weight="bold" className="text-[#e14d1a]" />
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-3 text-[#555] text-xs">
          <div className="h-px flex-1 bg-[#2a2a2a]" />
          or
          <div className="h-px flex-1 bg-[#2a2a2a]" />
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-[#ede6e6] placeholder-[#666] focus:outline-none focus:border-[#e14d1a]"
          />
          <input
            type="password"
            required
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-[#ede6e6] placeholder-[#666] focus:outline-none focus:border-[#e14d1a]"
          />
          {error && <div className="text-sm text-[#e74c3c]">{error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-[#e14d1a] hover:bg-[#f15d2a] disabled:opacity-60 text-white rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
          >
            {busy ? "signing in…" : "sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
