"use client";

import { useState } from "react";
import { DEMO_SESSION_ID } from "@/lib/portal/demo";

type Mode = "code" | "waitlist";

export default function ClaimPage() {
  const [mode, setMode] = useState<Mode>("code");
  const [code, setCode] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onClaim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
      if (!res.ok || !data.sessionId) {
        setError(data.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      window.location.replace(`/dash/${data.sessionId}`);
    } catch {
      setError("Network problem. Try again.");
      setBusy(false);
    }
  }

  async function onWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: businessName, phone, website }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      window.location.replace(`/dash/${DEMO_SESSION_ID}`);
    } catch {
      setError("Network problem. Try again.");
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
          <div className="text-sm text-[#888] mt-3">
            {mode === "code" ? "enter your access code" : "get on the waitlist"}
          </div>
        </div>

        {mode === "code" ? (
          <form onSubmit={onClaim} className="space-y-3">
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
            {error && <div className="text-sm text-[#e74c3c]">{error}</div>}
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-[#e14d1a] hover:bg-[#f15d2a] disabled:opacity-60 text-white rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            >
              {busy ? "unlocking…" : "unlock"}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("waitlist");
                }}
                className="text-xs text-[#e14d1a] hover:text-[#f15d2a]"
              >
                Don&apos;t have a code?
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={onWaitlist} className="space-y-3">
            <input
              type="text"
              required
              placeholder="business name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-[#ede6e6] placeholder-[#666] focus:outline-none focus:border-[#e14d1a]"
            />
            <input
              type="tel"
              placeholder="phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-[#ede6e6] placeholder-[#666] focus:outline-none focus:border-[#e14d1a]"
            />
            <input
              type="url"
              placeholder="website (optional)"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-[#ede6e6] placeholder-[#666] focus:outline-none focus:border-[#e14d1a]"
            />
            {error && <div className="text-sm text-[#e74c3c]">{error}</div>}
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-[#e14d1a] hover:bg-[#f15d2a] disabled:opacity-60 text-white rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            >
              {busy ? "joining…" : "join + see demo"}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("code");
                }}
                className="text-xs text-[#888] hover:text-[#ede6e6]"
              >
                back
              </button>
            </div>
          </form>
        )}

        <div className="mt-6 text-center text-xs text-[#666]">
          not you?{" "}
          <a href="/auth/signout" className="text-[#e14d1a] hover:text-[#f15d2a]">
            sign out
          </a>
        </div>
      </div>
    </main>
  );
}
