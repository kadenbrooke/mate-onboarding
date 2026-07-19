"use client"

import type { AgentCard } from "@/lib/portal/capabilities"

/** The Auto Mate 5 as status cards: LIVE (green) / DEMO (amber) / COMING SOON
 *  (gray + honest reason). */

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

export default function AgentsTab({ agents }: { agents: AgentCard[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {agents.map((a) => (
        <div
          key={a.key}
          style={{
            background: "#1a1a1a",
            border: "1px solid #333333",
            borderRadius: 14,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--mate-accent, #ede6e6)", margin: 0 }}>
              {a.label}
            </p>
            {a.reason && (
              <p style={{ fontSize: 12, color: "#888888", margin: "3px 0 0", lineHeight: 1.4 }}>
                {a.reason}
              </p>
            )}
          </div>
          <span style={BADGES[a.status]}>{LABELS[a.status]}</span>
        </div>
      ))}
    </div>
  )
}
