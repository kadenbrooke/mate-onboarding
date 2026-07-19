"use client"

import { useEffect, useState } from "react"

/**
 * Birth-sequence transition screens (founder directive 2026-07-19).
 *
 * GatheringTransition: chat -> review beat (~1.6s). The orb pulses while the
 * capability chips "fly in", copy says we're pulling their setup together.
 *
 * BirthTransition: review -> Command Center payoff (~3.2s). The orb swells to
 * full brand brightness, the agent speaks its first words by name, then we
 * announce the Command Center and the parent navigates.
 *
 * Both are pure client components: no fetching, no persistence. The parent
 * owns timing via onDone (fired once, from a timeout cleaned up on unmount).
 * Styling rides the --mate-* vars so the moment is in THEIR brand. White-label,
 * Phosphor-free (pure CSS shapes), no em dashes, no emoji.
 */

const GATHER_MS = 1600
const BIRTH_MS = 3200

const S = {
  wrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 22,
    minHeight: "50dvh",
    textAlign: "center" as const,
  } as React.CSSProperties,
  line: {
    fontFamily: "var(--font-display)",
    fontSize: 18,
    fontWeight: 700,
    color: "var(--mate-accent, #ede6e6)",
    margin: 0,
    lineHeight: 1.4,
  } as React.CSSProperties,
  subLine: {
    fontSize: 13.5,
    color: "#9a9a9a",
    margin: 0,
  } as React.CSSProperties,
}

/** The agent orb. `alive` swells + glows it in the brand primary. */
function Orb({ alive, size = 72 }: { alive: boolean; size?: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: alive
          ? "radial-gradient(circle at 35% 35%, var(--mate-primary, #e14d1a), color-mix(in srgb, var(--mate-primary, #e14d1a) 35%, #000000) 72%)"
          : "radial-gradient(circle at 35% 35%, #555555, #222222 70%)",
        boxShadow: alive
          ? "0 0 42px color-mix(in srgb, var(--mate-primary, #e14d1a) 55%, transparent)"
          : "none",
        transform: alive ? "scale(1)" : "scale(0.82)",
        transition:
          "background 900ms ease, box-shadow 900ms ease, transform 900ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        animation: "mate-orb-breathe 1.8s ease-in-out infinite",
      }}
    />
  )
}

/** Keyframes injected once per mount; scoped names to avoid collisions. */
function Keyframes() {
  return (
    <style>{`
      @keyframes mate-orb-breathe {
        0%, 100% { filter: brightness(1); }
        50% { filter: brightness(1.18); }
      }
      @keyframes mate-chip-in {
        from { opacity: 0; transform: translateY(10px) scale(0.9); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes mate-fade-in {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  )
}

export function GatheringTransition({
  chips,
  onDone,
}: {
  /** Unlocked capability chip labels to fly in (from the vitality lib). */
  chips: string[]
  onDone: () => void
}) {
  useEffect(() => {
    const t = setTimeout(onDone, GATHER_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={S.wrap}>
      <Keyframes />
      <Orb alive={false} size={56} />
      <p style={S.line}>Pulling your setup together...</p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 6,
          maxWidth: 380,
        }}
      >
        {chips.map((label, i) => (
          <span
            key={label}
            style={{
              fontSize: 12,
              padding: "4px 11px",
              borderRadius: 999,
              border: "1px solid var(--mate-primary, #e14d1a)",
              color: "var(--mate-primary, #e14d1a)",
              opacity: 0,
              animation: `mate-chip-in 350ms ease forwards`,
              animationDelay: `${150 + i * 160}ms`,
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function BirthTransition({
  agentName,
  businessName,
  onDone,
}: {
  agentName: string
  businessName: string
  onDone: () => void
}) {
  // Three staged beats: orb wakes -> first words -> destination line.
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 700)
    const t2 = setTimeout(() => setStage(2), 1800)
    const t3 = setTimeout(onDone, BIRTH_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={S.wrap}>
      <Keyframes />
      <Orb alive={stage >= 1} size={84} />
      {stage >= 1 && (
        <p style={{ ...S.line, animation: "mate-fade-in 500ms ease" }}>
          I&apos;m {agentName}, the new assistant for {businessName}.
        </p>
      )}
      {stage >= 2 && (
        <p style={{ ...S.subLine, animation: "mate-fade-in 500ms ease" }}>
          Opening your Command Center...
        </p>
      )}
    </div>
  )
}
