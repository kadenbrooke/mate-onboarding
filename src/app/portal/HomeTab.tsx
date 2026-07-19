"use client"

import { ChartLineUp, ShieldCheck } from "@phosphor-icons/react"

/**
 * Command Center Home: analytics with the HARD RULE - real data only. The
 * baseline tile renders the client's OWN onboarding numbers (deterministic
 * loss math). Live-stat tiles are honest placeholders until real interactions
 * exist; they light up per-client as agents ship. ZERO fabricated numbers.
 */

export interface Baseline {
  annualLoss: number
  leadsPerWeek: number
  avgJobValue: number
}

const tile: React.CSSProperties = {
  background: "#1a1a1a",
  border: "1px solid #333333",
  borderRadius: 14,
  padding: 16,
}

export default function HomeTab({ baseline }: { baseline: Baseline | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {baseline && (
        <div style={{ ...tile, borderColor: "color-mix(in srgb, var(--mate-primary, #e14d1a) 40%, #333333)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <ShieldCheck size={18} weight="fill" color="var(--mate-primary, #e14d1a)" />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--mate-accent, #ede6e6)" }}>
              What your assistant is set up to recover
            </span>
          </div>
          <p style={{ fontSize: 26, fontWeight: 800, color: "var(--mate-primary, #e14d1a)", margin: "0 0 4px" }}>
            ${baseline.annualLoss.toLocaleString("en-US")} / year
          </p>
          <p style={{ fontSize: 12.5, color: "#9a9a9a", margin: 0, lineHeight: 1.5 }}>
            Based on your numbers: {baseline.leadsPerWeek} leads a week at $
            {baseline.avgJobValue.toLocaleString("en-US")} a job, with 1 in 10
            currently slipping away unanswered.
          </p>
        </div>
      )}

      <div style={tile}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <ChartLineUp size={18} color="var(--mate-primary, #e14d1a)" />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--mate-accent, #ede6e6)" }}>
            Live results
          </span>
        </div>
        <p style={{ fontSize: 13, color: "#888888", margin: 0, lineHeight: 1.5 }}>
          Leads answered, response times, and jobs recovered appear here the
          moment your assistant goes live and real data starts flowing. Nothing
          on this page is ever estimated or made up.
        </p>
      </div>
    </div>
  )
}
