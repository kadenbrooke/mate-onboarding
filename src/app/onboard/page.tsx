"use client"

import { useEffect, useRef, useState } from "react"
import WebsiteStep, { type ResearchResult } from "./website-step"
import MateChat from "./mate-chat"
import type { Brand, CompanyData } from "@/lib/research/website"

// Client-side onboarding orchestrator. Bootstraps (or loads) a session, then
// renders the website step until a brand is captured, then the concierge chat.
// The shell background is wired to var(--mate-bg) so the whole surface recolors
// to the client's brand once the theme is applied, with the dark default as
// fallback. No Auto Mate branding — this is white-label per tenant.

const SESSION_STORAGE_KEY = "mate_onboarding_session_id"

type Step = "website" | "chat"

interface LoadedSession {
  id: string
  mate_name: string | null
  website_url: string | null
  brand: Brand | null
  collected: { company?: CompanyData } | null
  step: string | null
  messages: { role: "user" | "assistant"; content: string }[] | null
}

const S = {
  page: {
    // The client's brand background takes over once applied; dark default first.
    minHeight: "100dvh",
    background: "var(--mate-bg, #141414)",
    color: "var(--mate-accent, #ede6e6)",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "clamp(20px, 6vw, 56px) 20px",
    transition: "background 400ms ease",
  } as React.CSSProperties,
  inner: {
    width: "100%",
    maxWidth: 560,
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
    minHeight: 0,
  } as React.CSSProperties,
  heading: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    fontWeight: 700,
    color: "var(--mate-accent, #ede6e6)",
    margin: 0,
  } as React.CSSProperties,
  sub: {
    fontSize: 14,
    color: "#888888",
    margin: 0,
  } as React.CSSProperties,
  loading: {
    fontSize: 14,
    color: "#888888",
  } as React.CSSProperties,
  errorBox: {
    fontSize: 14,
    color: "#f5a97f",
    maxWidth: 480,
  } as React.CSSProperties,
}

function applyBrandTheme(brand: Brand | null | undefined) {
  if (!brand) return
  const root = document.documentElement
  root.style.setProperty("--mate-primary", brand.colors.primary)
  root.style.setProperty("--mate-bg", brand.colors.bg)
  root.style.setProperty("--mate-accent", brand.colors.accent)
}

export default function OnboardPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>("website")
  const [brand, setBrand] = useState<Brand | null>(null)
  const [company, setCompany] = useState<CompanyData | null>(null)
  const [mateName, setMateName] = useState<string | null>(null)
  const [priorMessages, setPriorMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([])
  const [bootError, setBootError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // Guard against React 18/19 StrictMode double-invoking the bootstrap effect.
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true

    async function bootstrap() {
      try {
        const params = new URLSearchParams(window.location.search)
        const urlSession = params.get("session")
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(SESSION_STORAGE_KEY)
            : null
        const existingId = urlSession || stored

        if (existingId) {
          const res = await fetch(
            `/api/session?id=${encodeURIComponent(existingId)}`
          )
          if (res.ok) {
            const data = (await res.json()) as LoadedSession
            hydrateFromSession(data)
            setReady(true)
            return
          }
          // Stale/invalid id (e.g. deleted row): drop it and create a fresh one.
          if (res.status === 404) {
            window.localStorage.removeItem(SESSION_STORAGE_KEY)
          }
        }

        // No usable session — create one.
        const created = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
        if (!created.ok) throw new Error("Could not start onboarding.")
        const { id } = (await created.json()) as { id: string }
        window.localStorage.setItem(SESSION_STORAGE_KEY, id)
        setSessionId(id)
        setStep("website")
        setReady(true)
      } catch (err) {
        setBootError(
          err instanceof Error ? err.message : "Could not start onboarding."
        )
        setReady(true)
      }
    }

    function hydrateFromSession(data: LoadedSession) {
      setSessionId(data.id)
      window.localStorage.setItem(SESSION_STORAGE_KEY, data.id)
      if (data.mate_name) setMateName(data.mate_name)
      if (data.brand) {
        setBrand(data.brand)
        applyBrandTheme(data.brand)
      }
      if (data.collected?.company) setCompany(data.collected.company)
      if (Array.isArray(data.messages)) setPriorMessages(data.messages)

      // Resume at the chat step if the session already moved past 'website'
      // (or if a brand was captured), otherwise start at the website step.
      const persistedStep = data.step
      if (persistedStep === "chat" || (data.brand && persistedStep !== "website")) {
        setStep("chat")
      } else {
        setStep("website")
      }
    }

    bootstrap()
  }, [])

  function handleWebsiteDone(result: ResearchResult) {
    setBrand(result.brand)
    setCompany(result.company)
    setStep("chat")

    // Persist the advanced step so a reload resumes in the chat, not the
    // website step. Fire-and-forget: a save hiccup shouldn't block the owner.
    if (sessionId) {
      fetch("/api/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, step: "chat" }),
      }).catch(() => {
        // Non-fatal; the client already advanced in memory for this session.
      })
    }
  }

  return (
    <div style={S.page}>
      <div style={S.inner}>
        {!ready && <p style={S.loading}>Loading...</p>}

        {ready && bootError && (
          <p style={S.errorBox}>
            {bootError} Please refresh to try again.
          </p>
        )}

        {ready && !bootError && sessionId && step === "website" && (
          <>
            <div>
              <h1 style={S.heading}>Let&apos;s get you set up</h1>
              <p style={S.sub}>
                Start with your website so we can match your brand.
              </p>
            </div>
            <WebsiteStep sessionId={sessionId} onDone={handleWebsiteDone} />
          </>
        )}

        {ready && !bootError && sessionId && step === "chat" && (
          <MateChat
            sessionId={sessionId}
            brand={brand}
            company={company}
            mateName={mateName}
            initialMessages={priorMessages}
          />
        )}
      </div>
    </div>
  )
}
