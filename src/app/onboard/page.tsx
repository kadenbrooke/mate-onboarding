"use client"

import { useEffect, useRef, useState } from "react"
import WebsiteStep, { type ResearchResult } from "./website-step"
import MateChat from "./mate-chat"
import CardRail, { type CollectedShape } from "./cards/CardRail"
import SandboxReveal from "./reveal"
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
  collected: CollectedShape | null
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
  const [collected, setCollected] = useState<CollectedShape>({})
  const [mateName, setMateName] = useState<string | null>(null)
  const [priorMessages, setPriorMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([])
  const [bootError, setBootError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // True once all structured cards are complete (session step === 'ready'). Gates
  // the personalized sandbox reveal so the owner can text their own agent.
  const [revealed, setRevealed] = useState(false)
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
      if (data.collected && typeof data.collected === "object") {
        setCollected(data.collected)
        if (data.collected.company) setCompany(data.collected.company)
      }
      if (Array.isArray(data.messages)) setPriorMessages(data.messages)

      // Resume at the chat step (chat + card rail) once the session moved past
      // 'website' — that includes 'chat' and 'ready'. Otherwise start at the
      // website step. A brand having been captured also implies past 'website'.
      const persistedStep = data.step
      if (
        persistedStep === "chat" ||
        persistedStep === "ready" ||
        (data.brand && persistedStep !== "website")
      ) {
        setStep("chat")
      } else {
        setStep("website")
      }

      // A session already at 'ready' has finished the cards — surface the reveal
      // straight away so a reload lands the owner back on their agent demo.
      if (persistedStep === "ready") {
        setRevealed(true)
        advancedToReady.current = true
      }
    }

    bootstrap()
  }, [])

  function handleWebsiteDone(result: ResearchResult) {
    setBrand(result.brand)
    setCompany(result.company)
    setCollected((prev) => ({ ...prev, company: result.company }))
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

  // Fired by the card rail once every required structured field is collected.
  // Advance the session step to 'ready' (sets up the later reveal/portal task).
  // Idempotent: guarded so we only patch once per session lifetime.
  const advancedToReady = useRef(false)
  // Separate one-shot guard for the provisioning call. Kept distinct from
  // advancedToReady (which resets on PATCH failure to allow a re-advance) so a
  // retried PATCH never re-fires completion. The route is itself idempotent, so
  // a rare double-call is safe; this just avoids spamming it.
  const completionFired = useRef(false)
  function handleCardsDone() {
    // Reveal the sandbox as soon as the cards complete, even before the PATCH
    // round-trips — it reads only in-memory collected, no server dependency.
    setRevealed(true)
    if (!sessionId) return

    // Provision the client (create CRM contact, auto-complete materials, seed
    // capabilities, mark session complete). Fire-and-forget so the reveal is
    // never blocked, but exactly once per session. Without this, the session's
    // contact_id stays null and /portal never leaves its unfinished state.
    if (!completionFired.current) {
      completionFired.current = true
      fetch("/api/mate/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
        .then(async (res) => {
          if (!res.ok) {
            // Route failed outright; allow a later cards-done to retry.
            completionFired.current = false
            // eslint-disable-next-line no-console
            console.error(
              "onboarding completion failed",
              res.status,
              await res.text().catch(() => "")
            )
            return
          }
          // Partial-failure warnings (materials/capabilities) come back in the
          // body; surface them for debugging without disrupting the reveal.
          const data = (await res.json().catch(() => null)) as
            | { warnings?: string[] }
            | null
          if (data?.warnings?.length) {
            // eslint-disable-next-line no-console
            console.warn("onboarding completion warnings", data.warnings)
          }
        })
        .catch((err) => {
          // Network error: log, don't crash the reveal, allow a retry.
          completionFired.current = false
          // eslint-disable-next-line no-console
          console.error("onboarding completion request errored", err)
        })
    }

    if (advancedToReady.current) return
    advancedToReady.current = true
    fetch("/api/session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sessionId, step: "ready" }),
    }).catch(() => {
      // Non-fatal; a later save will re-advance.
      advancedToReady.current = false
    })
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
          <>
            <CardRail
              sessionId={sessionId}
              initialCollected={collected}
              onAllDone={handleCardsDone}
            />
            <MateChat
              sessionId={sessionId}
              brand={brand}
              company={company}
              mateName={mateName}
              initialMessages={priorMessages}
            />
            {revealed && (
              <SandboxReveal sessionId={sessionId} collected={collected} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
