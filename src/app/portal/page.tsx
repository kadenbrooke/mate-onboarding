"use client"

import { useEffect, useRef, useState } from "react"
import { House, Robot, ChatCircleDots } from "@phosphor-icons/react"
import MateChat from "../onboard/mate-chat"
import HomeTab, { type Baseline } from "./HomeTab"
import AgentsTab from "./AgentsTab"
import type { Cap, Req, AgentCard } from "@/lib/portal/capabilities"

// Post-onboarding client Command Center. Three tabs: Home (baseline + honest
// live-result placeholders), Agents (Auto Mate 5 status cards), Chat (Business
// Mate). Tabs switch via a bottom nav. The load flow is the same as Phase 1
// (session from ?session= param or localStorage, soft errors, notice states).
//
// White-label: no Auto Mate / Kaden branding. The whole surface recolors to the
// client's brand via the --mate-* tokens (default dark shell as fallback).

// Same storage key the onboarding flow writes, so a client who finished
// onboarding on this device lands straight in their portal.
const SESSION_STORAGE_KEY = "mate_onboarding_session_id"

type Tab = "home" | "agents" | "chat"

interface PortalData {
  capabilities: Cap[]
  buildRequests: Req[]
  mate_name: string | null
  onboardingComplete: boolean
  agents: AgentCard[]
  baseline: Baseline | null
  businessName: string | null
}

const S = {
  page: {
    minHeight: "100dvh",
    background: "var(--mate-bg, #141414)",
    color: "var(--mate-accent, #ede6e6)",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "clamp(20px, 6vw, 56px) 20px 0",
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
    paddingBottom: 16,
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
  const [tab, setTab] = useState<Tab>("home")
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
            <h1 style={S.heading}>Command Center</h1>
            <p style={S.sub}>
              Open your portal from the link we sent you so we can load your
              account.
            </p>
          </div>
        )}

        {ready && !error && !noSession && (
          <>
            <div>
              <h1 style={S.heading}>{data?.businessName ?? "Command Center"}</h1>
              {data?.businessName && <p style={S.sub}>Command Center</p>}
            </div>

            {!onboardingComplete && (
              <p style={S.notice}>
                Your setup is not finished yet. Once onboarding is complete, your
                Command Center fills in here.
              </p>
            )}

            {/* All three panes stay MOUNTED; tabs toggle visibility. Unmounting
                the chat on tab-away would wipe the visible thread and re-seed
                the onboarding greeting on return (the server keeps history the
                client couldn't see). display:none also preserves chat scroll. */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              <div style={{ display: tab === "home" ? "block" : "none" }}>
                <HomeTab baseline={data?.baseline ?? null} />
              </div>
              <div style={{ display: tab === "agents" ? "block" : "none" }}>
                <AgentsTab agents={data?.agents ?? []} />
              </div>
              {sessionId && (
                <div
                  style={{
                    ...S.chatWrap,
                    display: tab === "chat" ? "flex" : "none",
                  }}
                >
                  <MateChat sessionId={sessionId} mateName={mateName} />
                </div>
              )}
            </div>

            <nav
              aria-label="Command Center sections"
              style={{
                display: "flex",
                justifyContent: "space-around",
                borderTop: "1px solid #333333",
                paddingTop: 10,
                // iOS standalone-PWA home indicator clearance.
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
                flexShrink: 0,
              }}
            >
              {(
                [
                  ["home", "Home", House],
                  ["agents", "Agents", Robot],
                  ["chat", "Chat", ChatCircleDots],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={tab === key ? "page" : undefined}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    fontSize: 11.5,
                    fontWeight: tab === key ? 700 : 400,
                    color: tab === key ? "var(--mate-primary, #e14d1a)" : "#888888",
                    padding: "4px 14px",
                  }}
                >
                  <Icon size={22} weight={tab === key ? "fill" : "regular"} />
                  {label}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
    </div>
  )
}
