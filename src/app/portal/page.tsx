"use client"

import { useEffect, useRef, useState } from "react"
import { ChartLineUp } from "@phosphor-icons/react"
import MateChat from "../onboard/mate-chat"
import LivePanel from "./LivePanel"
import UnderConstructionPanel from "./UnderConstructionPanel"
import { splitCapabilities, type Cap, type Req } from "@/lib/portal/capabilities"

// Post-onboarding client portal. The SAME app becomes the client's ongoing
// portal: Mate persists as the conversational point of contact, and their
// capabilities split into two honest zones (Live vs Under Construction). Deep
// point-of-contact features (live lead stats, monthly ROI) are Phase 2 — shown
// here as a clearly-labeled "coming soon" placeholder with NO fabricated data.
//
// White-label: no Auto Mate / Kaden branding. The whole surface recolors to the
// client's brand via the --mate-* tokens (default dark shell as fallback).

// Same storage key the onboarding flow writes, so a client who finished
// onboarding on this device lands straight in their portal.
const SESSION_STORAGE_KEY = "mate_onboarding_session_id"

interface PortalData {
  capabilities: Cap[]
  buildRequests: Req[]
  mate_name: string | null
  onboardingComplete: boolean
}

const S = {
  page: {
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
    margin: "4px 0 0",
  } as React.CSSProperties,
  loading: {
    fontSize: 14,
    color: "#888888",
  } as React.CSSProperties,
  notice: {
    fontSize: 13,
    color: "#c9a15f",
    background: "#1c1c1c",
    border: "1px solid #3a3a3a",
    borderRadius: 10,
    padding: "10px 12px",
    lineHeight: 1.5,
    margin: 0,
  } as React.CSSProperties,
  errorBox: {
    fontSize: 14,
    color: "#f5a97f",
    maxWidth: 480,
  } as React.CSSProperties,
  comingSoon: {
    background: "#161616",
    border: "1px solid #2a2a2a",
    borderRadius: 14,
    padding: "18px",
  } as React.CSSProperties,
  comingSoonHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  } as React.CSSProperties,
  comingSoonTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--mate-accent, #ede6e6)",
    margin: 0,
  } as React.CSSProperties,
  comingSoonBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: "#888888",
    border: "1px solid #333333",
    borderRadius: 999,
    padding: "2px 8px",
    letterSpacing: "0.02em",
  } as React.CSSProperties,
  comingSoonBody: {
    fontSize: 13,
    color: "#888888",
    lineHeight: 1.5,
    margin: 0,
  } as React.CSSProperties,
  chatWrap: {
    display: "flex",
    flexDirection: "column" as const,
    flex: 1,
    minHeight: 320,
  } as React.CSSProperties,
}

export default function PortalPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [data, setData] = useState<PortalData | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // No session id at all -> we can't identify the client. Distinct from a valid
  // session whose onboarding simply is not finished.
  const [noSession, setNoSession] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true

    async function load() {
      try {
        const params = new URLSearchParams(window.location.search)
        const urlSession = params.get("session")
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(SESSION_STORAGE_KEY)
            : null
        const id = urlSession || stored

        if (!id) {
          setNoSession(true)
          setReady(true)
          return
        }

        setSessionId(id)
        // Persist the id if it came from the URL, so a later reload without the
        // query param still resolves.
        if (urlSession) window.localStorage.setItem(SESSION_STORAGE_KEY, id)

        const res = await fetch(`/api/portal?session=${encodeURIComponent(id)}`)
        if (!res.ok) {
          // The API is designed to soft-error to 200; a non-2xx here is unusual.
          throw new Error("Could not load your portal.")
        }
        const json = (await res.json()) as PortalData
        setData(json)
        setReady(true)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load your portal."
        )
        setReady(true)
      }
    }

    load()
  }, [])

  const capabilities = data?.capabilities ?? []
  const buildRequests = data?.buildRequests ?? []
  const { live, underConstruction } = splitCapabilities(capabilities, buildRequests)
  const mateName = data?.mate_name ?? null
  const onboardingComplete = data?.onboardingComplete ?? false

  return (
    <div style={S.page}>
      <div style={S.inner}>
        {!ready && <p style={S.loading}>Loading your portal...</p>}

        {ready && error && (
          <p style={S.errorBox}>{error} Please refresh to try again.</p>
        )}

        {ready && !error && noSession && (
          <div>
            <h1 style={S.heading}>Your portal</h1>
            <p style={S.sub}>
              Open your portal from the link we sent you so we can load your
              account.
            </p>
          </div>
        )}

        {ready && !error && !noSession && (
          <>
            <div>
              <h1 style={S.heading}>Your portal</h1>
              <p style={S.sub}>
                Here is what is working now and what is on the way.
              </p>
            </div>

            {!onboardingComplete && (
              <p style={S.notice}>
                Your setup is not finished yet. Once onboarding is complete, your
                live features and everything in the works will appear here.
              </p>
            )}

            <LivePanel items={live} />
            <UnderConstructionPanel items={underConstruction} />

            {/* Phase-2 point-of-contact features. Honest placeholder only — NEVER
                fabricated numbers or fake charts. */}
            <div style={S.comingSoon}>
              <div style={S.comingSoonHead}>
                <ChartLineUp
                  size={20}
                  weight="regular"
                  color="var(--mate-primary, #e14d1a)"
                />
                <h2 style={S.comingSoonTitle}>Your results</h2>
                <span style={S.comingSoonBadge}>COMING SOON</span>
              </div>
              <p style={S.comingSoonBody}>
                Your results dashboard activates once your system is live and
                collecting data. You will see your leads and your return here as
                soon as the numbers are real.
              </p>
            </div>

            {sessionId && (
              <div style={S.chatWrap}>
                <MateChat sessionId={sessionId} mateName={mateName} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
