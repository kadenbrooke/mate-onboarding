"use client"

import { vitality } from "@/lib/mate/vitality"

/**
 * The birth-progress strip: avatar orb (dim -> brand-bright), progress bar,
 * capability chips that light up as milestones land. Pure render over the
 * vitality lib; no fetching (page passes collected).
 */
export default function VitalityHeader({
  collected,
}: {
  collected: Record<string, unknown>
}) {
  const { chips, percent } = vitality(collected)
  const alive = percent > 0

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            flexShrink: 0,
            background: alive
              ? "radial-gradient(circle at 35% 35%, var(--mate-primary, #e14d1a), color-mix(in srgb, var(--mate-primary, #e14d1a) 35%, #000000) 70%)"
              : "radial-gradient(circle at 35% 35%, #555555, #222222 70%)",
            boxShadow: alive
              ? "0 0 12px color-mix(in srgb, var(--mate-primary, #e14d1a) 45%, transparent)"
              : "none",
            opacity: 0.35 + 0.65 * (percent / 100),
            transition: "opacity 500ms ease, box-shadow 500ms ease",
          }}
        />
        <div
          style={{
            flex: 1,
            height: 6,
            borderRadius: 999,
            background: "#222222",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              background: "var(--mate-primary, #e14d1a)",
              transition: "width 500ms ease",
            }}
          />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mate-accent, #ede6e6)" }}>
          {percent}%
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chips.map((c) => (
          <span
            key={c.key}
            style={{
              fontSize: 11,
              padding: "3px 9px",
              borderRadius: 999,
              border: `1px solid ${c.unlocked ? "var(--mate-primary, #e14d1a)" : "#333333"}`,
              color: c.unlocked ? "var(--mate-primary, #e14d1a)" : "#777777",
              transition: "color 400ms ease, border-color 400ms ease",
            }}
          >
            {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}
