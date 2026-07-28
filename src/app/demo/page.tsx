"use client"

import { useState } from "react"
import { ArrowRight, Phone, ChatCircleDots, CheckCircle } from "@phosphor-icons/react"

// Public, unauthed lander for the Instant First Responder Demo.
//
// Flow: prospect enters website URL + phone -> POST /api/demo/start scrapes their
// site and builds an FR persona in their voice -> we show "now call this number".
// They call the ONE shared demo number; it does not answer (3s "sorry we missed
// you" then hangup), and ~5s later their phone buzzes with a missed-call text-back
// in their business voice. Caller ID is the join key. The 4-digit code is the
// no-caller-ID fallback: "text CODE to this number first".
//
// White-label by design (matches the rest of mate-onboarding): NO Auto Mate
// branding on this prospect-facing surface. Phosphor icons, no emoji, no em dash.

type Phase = "form" | "building" | "ready"

interface StartResult {
  sessionId: string
  phoneCode: string
  demoNumber: string
  businessName?: string
}

const S = {
  page: {
    minHeight: "100dvh",
    background: "#141414",
    color: "#ede6e6",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "clamp(20px, 6vw, 56px) 20px",
    fontFamily: "var(--font-body)",
  } as React.CSSProperties,
  inner: {
    width: "100%",
    maxWidth: 480,
    display: "flex",
    flexDirection: "column" as const,
    gap: 22,
  } as React.CSSProperties,
  h1: {
    fontFamily: "var(--font-body)",
    fontWeight: 700,
    fontSize: "clamp(26px, 6vw, 34px)",
    lineHeight: 1.12,
    margin: 0,
    letterSpacing: "-0.01em",
  } as React.CSSProperties,
  sub: { fontSize: 15, color: "#9a9a9a", margin: 0, lineHeight: 1.5 } as React.CSSProperties,
  label: { fontSize: 13, color: "#b9b9b9", marginBottom: 6, display: "block" } as React.CSSProperties,
  input: {
    width: "100%",
    background: "#1d1d1d",
    border: "1px solid #333",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 16,
    color: "#ede6e6",
    fontFamily: "var(--font-body)",
    outline: "none",
  } as React.CSSProperties,
  btn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "#e14d1a",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "15px 18px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    width: "100%",
  } as React.CSSProperties,
  btnDisabled: { opacity: 0.55, cursor: "not-allowed" } as React.CSSProperties,
  err: { fontSize: 14, color: "#f5a97f", margin: 0 } as React.CSSProperties,
  card: {
    background: "#1d1d1d",
    border: "1px solid #2c2c2c",
    borderRadius: 16,
    padding: 22,
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  } as React.CSSProperties,
  bigNumber: {
    fontSize: "clamp(24px, 7vw, 32px)",
    fontWeight: 700,
    letterSpacing: "0.01em",
    color: "#ede6e6",
    textDecoration: "none",
  } as React.CSSProperties,
  step: { display: "flex", gap: 12, alignItems: "flex-start", fontSize: 14.5, color: "#c9c9c9", lineHeight: 1.45 } as React.CSSProperties,
  codePill: {
    display: "inline-block",
    background: "#141414",
    border: "1px dashed #444",
    borderRadius: 10,
    padding: "6px 12px",
    fontWeight: 700,
    letterSpacing: "0.18em",
    fontSize: 18,
    color: "#e14d1a",
  } as React.CSSProperties,
  fine: { fontSize: 12.5, color: "#7d7d7d", lineHeight: 1.5, margin: 0 } as React.CSSProperties,
}

/** Format a +1XXXXXXXXXX for display as (XXX) XXX-XXXX; pass through otherwise. */
function displayNumber(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

export default function DemoPage() {
  const [phase, setPhase] = useState<Phase>("form")
  const [url, setUrl] = useState("")
  const [phone, setPhone] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StartResult | null>(null)

  const canSubmit = url.trim() !== "" && phone.trim() !== "" && phase !== "building"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setPhase("building")
    try {
      const res = await fetch("/api/demo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.")
        setPhase("form")
        return
      }
      setResult(data as StartResult)
      setPhase("ready")
    } catch {
      setError("Could not reach the server. Please try again.")
      setPhase("form")
    }
  }

  return (
    <main style={S.page}>
      <div style={S.inner}>
        {phase !== "ready" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h1 style={S.h1}>See your business text back a missed call in 30 seconds</h1>
              <p style={S.sub}>
                Enter your website and phone. We will read your site, build a text-back
                assistant in your business voice, and let you experience it live on your
                own phone.
              </p>
            </div>

            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={S.label} htmlFor="url">Your website</label>
                <input
                  id="url"
                  style={S.input}
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="yourbusiness.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={phase === "building"}
                />
              </div>
              <div>
                <label style={S.label} htmlFor="phone">Your mobile number</label>
                <input
                  id="phone"
                  style={S.input}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(801) 555-0123"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={phase === "building"}
                />
              </div>

              {error && <p style={S.err}>{error}</p>}

              <button
                type="submit"
                style={{ ...S.btn, ...(canSubmit ? {} : S.btnDisabled) }}
                disabled={!canSubmit}
              >
                {phase === "building" ? "Building your assistant..." : (
                  <>Build my demo <ArrowRight size={18} weight="bold" /></>
                )}
              </button>
              <p style={S.fine}>
                We use your number only to send this one demo text. No spam, no sharing.
              </p>
            </form>
          </>
        )}

        {phase === "ready" && result && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h1 style={S.h1}>
                {result.businessName && result.businessName !== "this business"
                  ? `${result.businessName} is ready`
                  : "Your assistant is ready"}
              </h1>
              <p style={S.sub}>Call the number below. It will not pick up, on purpose. Watch your phone.</p>
            </div>

            <div style={S.card}>
              <div style={S.step}>
                <Phone size={22} weight="fill" color="#e14d1a" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 13, color: "#9a9a9a", marginBottom: 4 }}>Call this number</div>
                  {result.demoNumber ? (
                    <a href={`tel:${result.demoNumber}`} style={S.bigNumber}>
                      {displayNumber(result.demoNumber)}
                    </a>
                  ) : (
                    <span style={{ ...S.bigNumber, color: "#f5a97f", fontSize: 16 }}>
                      Demo number not configured yet
                    </span>
                  )}
                </div>
              </div>
              <div style={S.step}>
                <ChatCircleDots size={22} weight="fill" color="#e14d1a" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>It rings, does not answer, then hangs up. About 5 seconds later your phone buzzes with a text back, in your business voice. Reply to it and see how it qualifies a lead.</div>
              </div>
              <div style={S.step}>
                <CheckCircle size={22} weight="fill" color="#e14d1a" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>That is exactly what your customers would get after a missed call.</div>
              </div>
            </div>

            <div style={S.card}>
              <div style={{ fontSize: 13.5, color: "#c9c9c9", lineHeight: 1.5 }}>
                Calling with caller ID hidden? Text this code to the same number first, then call:
              </div>
              <div><span style={S.codePill}>{result.phoneCode}</span></div>
            </div>

            <p style={S.fine}>This demo expires in 24 hours. Run it again anytime.</p>
          </>
        )}
      </div>
    </main>
  )
}
