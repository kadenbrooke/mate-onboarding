"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import WebsiteStep, { type ResearchResult } from "./website-step"
import MateChat from "./mate-chat"
import ReviewScreen, { type CollectedShape } from "./cards/ReviewScreen"
import { allRequiredPresent } from "@/lib/mate/required-fields"
import SandboxReveal from "./reveal"
import type { Brand, CompanyData } from "@/lib/research/website"

// Client-side onboarding orchestrator. Chat-first flow:
//   website  -> capture brand + rich research
//   chat     -> the ENTIRE guided conversation, chat is the only surface
//   review   -> one confirmation screen, everything Mate collected, editable
//   (finish) -> provision + sandbox reveal
//
// The shell background is wired to var(--mate-bg) so the whole surface recolors
// to the client's brand once the theme is applied, with the dark default as
// fallback. No Auto Mate branding — this is white-label per tenant.

const SESSION_STORAGE_KEY = "mate_onboarding_session_id"

type Step = "website" | "chat" | "review"

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
  // The "you're done chatting, review next" advance. Shown only once every
  // required field is captured in the conversation.
  advanceBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "var(--mate-primary, #e14d1a)",
    color: "#ffffff",
    border: "none",
    borderRadius: 12,
    padding: "14px 18px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "var(--font-display)",
    width: "100%",
    flexShrink: 0,
  } as React.CSSProperties,
  advanceNote: {
    fontSize: 12.5,
    color: "#9a9a9a",
    margin: "0 0 6px",
    textAlign: "center" as const,
    lineHeight: 1.45,
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
  // True once Mate has captured every required field (checked by re-fetching the
  // session after each turn). Gates the "Review your setup" advance.
  const [chatComplete, setChatComplete] = useState(false)
  // True once the review screen is confirmed (session step === 'ready'). Gates
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
      let hydratedCollected: CollectedShape = {}
      if (data.collected && typeof data.collected === "object") {
        hydratedCollected = data.collected
        setCollected(hydratedCollected)
        if (hydratedCollected.company) setCompany(hydratedCollected.company)
      }
      if (Array.isArray(data.messages)) setPriorMessages(data.messages)

      // If Mate already captured everything, unlock the review advance so a
      // resumed chat isn't stuck.
      if (allRequiredPresent(hydratedCollected)) setChatComplete(true)

      // Resume at the right phase. 'ready' is finished (reveal); 'review' is the
      // confirmation screen; 'chat' (or any post-website state) is the
      // conversation. A brand having been captured also implies past 'website'.
      const persistedStep = data.step
      if (persistedStep === "ready") {
        setStep("review")
        setRevealed(true)
        confirmed.current = true
        completionFired.current = true
      } else if (persistedStep === "review") {
        setStep("review")
      } else if (
        persistedStep === "chat" ||
        (data.brand && persistedStep !== "website")
      ) {
        setStep("chat")
      } else {
        setStep("website")
      }
    }

    bootstrap()
  }, [])

  // Re-fetch the session's persisted `collected` after a Mate turn and update
  // the completion gate. The mate route saves `collected` in its stream
  // onFinish, so by the time MateChat signals a completed turn this GET reflects
  // it. Non-fatal on error: the next turn re-checks.
  async function refreshCollected() {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId)}`)
      if (!res.ok) return
      const data = (await res.json()) as LoadedSession
      if (data.collected && typeof data.collected === "object") {
        setCollected(data.collected)
        if (data.collected.company) setCompany(data.collected.company)
        if (allRequiredPresent(data.collected)) setChatComplete(true)
      }
    } catch {
      // Non-fatal; completion is re-checked on the next turn.
    }
  }

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

  // Advance from the completed chat to the single review screen. Persists the
  // step so a reload lands on review. Idempotent-safe: the button is only shown
  // once chat is complete.
  function goToReview() {
    setStep("review")
    if (sessionId) {
      fetch("/api/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, step: "review" }),
      }).catch(() => {
        // Non-fatal; the client already advanced in memory for this session.
      })
    }
  }

  // Fired by the review screen's "Confirm and finish". Reveals the sandbox,
  // provisions the client (CRM contact, materials, capabilities, session
  // complete), and advances the session step to 'ready'. Guards keep the
  // provision + step-advance to exactly once per session.
  const confirmed = useRef(false)
  const completionFired = useRef(false)
  function handleFinish() {
    // Reveal the sandbox immediately — it reads only in-memory collected.
    setRevealed(true)
    if (!sessionId) return

    // Provision the client. Fire-and-forget so the reveal is never blocked, but
    // exactly once per session. Without this, the session's contact_id stays
    // null and /portal never leaves its unfinished state.
    if (!completionFired.current) {
      completionFired.current = true
      fetch("/api/mate/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
        .then(async (res) => {
          if (!res.ok) {
            // Route failed outright; allow a later confirm to retry.
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

    if (confirmed.current) return
    confirmed.current = true
    fetch("/api/session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sessionId, step: "ready" }),
    }).catch(() => {
      // Non-fatal; a later save will re-advance.
      confirmed.current = false
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
            <MateChat
              sessionId={sessionId}
              brand={brand}
              company={company}
              mateName={mateName}
              initialMessages={priorMessages}
              onTurnComplete={refreshCollected}
            />
            {chatComplete && (
              <>
                <p style={S.advanceNote}>
                  That&apos;s everything we need. Review it all and make any final
                  changes.
                </p>
                <button
                  type="button"
                  onClick={goToReview}
                  style={S.advanceBtn}
                  aria-label="Review your setup"
                >
                  Review your setup
                  <ArrowRight size={18} weight="bold" />
                </button>
              </>
            )}
          </>
        )}

        {ready && !bootError && sessionId && step === "review" && (
          <>
            {!revealed && (
              <ReviewScreen
                sessionId={sessionId}
                initialCollected={collected}
                onConfirm={handleFinish}
              />
            )}
            {revealed && (
              <SandboxReveal sessionId={sessionId} collected={collected} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
