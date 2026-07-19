"use client"

import { CaretRight } from "@phosphor-icons/react"
import type { AgentCard } from "@/lib/portal/capabilities"

/** The Auto Mate 5 as status cards: LIVE (green) / DEMO (amber, tappable ->
 *  opens the sandbox) / COMING SOON (gray + honest reason). */

const badgeBase: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  borderRadius: 999,
  padding: "2px 9px",
  letterSpacing: "0.04em",
}

const BADGES: Record<AgentCard["status"], React.CSSProperties> = {
  live: { ...badgeBase, background: "#143d1e", color: "#6ecf7a" },
  demo: { ...badgeBase, background: "#3d3214", color: "#e0c04c" },
  coming_soon: { ...badgeBase, background: "#2a2a2a", color: "#888888" },
}

const LABELS: Record<AgentCard["status"], string> = {
  live: "LIVE",
  demo: "DEMO",
  coming_soon: "COMING SOON",
}

export default function AgentsTab({
  agents,
  onDemoTap,
}: {
  agents: AgentCard[]
  /** Fired when a DEMO card is tapped (opens the sandbox for that agent). */
  onDemoTap?: (key: string) => void
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {agents.map((a) => {
        const tappable = a.status === "demo" && !!onDemoTap
        const inner = (
          <>
            <div style={{ textAlign: "left" }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--mate-accent, #ede6e6)", margin: 0 }}>
                {a.label}
              </p>
              {a.reason && (
                <p style={{ fontSize: 12, color: "#888888", margin: "3px 0 0", lineHeight: 1.4 }}>
                  {a.reason}
                </p>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={BADGES[a.status]}>{LABELS[a.status]}</span>
              {tappable && <CaretRight size={16} color="#e0c04c" />}
            </div>
          </>
        )
        const cardStyle: React.CSSProperties = {
          background: "#1a1a1a",
          border: tappable ? "1px solid #5a4a1a" : "1px solid #333333",
          borderRadius: 14,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          width: "100%",
        }
        return tappable ? (
          <button
            key={a.key}
            type="button"
            onClick={() => onDemoTap?.(a.key)}
            aria-label={`Try the ${a.label} demo`}
            style={{ ...cardStyle, cursor: "pointer", font: "inherit", color: "inherit" }}
          >
            {inner}
          </button>
        ) : (
          <div key={a.key} style={cardStyle}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}
