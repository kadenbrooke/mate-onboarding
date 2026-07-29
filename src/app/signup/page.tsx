"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
    if (!res.ok || !data.sessionId) {
      setError(data.error ?? "Something went wrong. Try again.");
      setBusy(false);
      return;
    }

    const supabase = createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      setError("Account created. Now sign in at the login page.");
      setBusy(false);
      return;
    }
    window.location.replace(`/onboard?session=${data.sessionId}`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="text-2xl font-bold text-[#ede6e6]" style={{ fontFamily: "var(--font-display)" }}>
            Mate
          </div>
          <div className="text-sm text-[#888] mt-3">create your account</div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="text"
            required
            placeholder="access code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-[#ede6e6] placeholder-[#666] focus:outline-none focus:border-[#e14d1a] tracking-widest"
          />
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
            minLength={8}
            placeholder="password (8+ characters)"
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
            {busy ? "setting up…" : "create account"}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-[#666]">
          already set up?{" "}
          <a href="/login" className="text-[#e14d1a] hover:text-[#f15d2a]">
            sign in
          </a>
        </div>
      </div>
    </main>
  );
}
