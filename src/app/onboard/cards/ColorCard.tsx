"use client"

import { useState } from "react"
import { Palette, CheckCircle, MagicWand } from "@phosphor-icons/react"
import { cardStyles, CardHead, saveCollected } from "./card-ui"
import { meetsAA, nearestAA, contrastRatio } from "@/lib/research/contrast"
import { deriveAccent } from "@/lib/research/color-util"
import type { Brand } from "@/lib/research/website"

/**
 * In-chat brand-color picker (the 3TR fix). Presents the extracted candidate
 * palette as swatches; the owner picks a background and a main color. WCAG AA
 * (4.5:1) is enforced: a failing combo shows a warning + "Fix it for me"
 * (nearest AA-passing shade of their pick, same hue) and confirm stays
 * disabled until the CURRENT active combo passes. Confirm persists
 * collected.brand_colors_confirmed, PATCHes session.brand, and re-themes the
 * app live via the --mate-* vars.
 *
 * Review note: the confirm gate checks meetsAA(primary, bg) of the CURRENT
 * pick, never assumes nearestAA output passes (for mid-tone backgrounds,
 * nearestAA can return a still-failing color; the disabled confirm is the
 * safety net).
 */

const FALLBACK_BGS = ["#141414", "#ffffff"]

export default function ColorCard({
  sessionId,
  brand,
  done,
  streaming,
  onDone,
}: {
  sessionId: string
  brand?: Brand | null
  done: boolean
  /** True while the parent chat is mid-stream; disables confirm to prevent concurrent submissions. */
  streaming?: boolean
  onDone: () => void
}) {
  // Prepend the brand's current primary to the candidate list if absent, so the
  // initial selection always matches a rendered swatch and the original pick is recoverable.
  const rawPrimaries =
    brand?.candidates?.primaries?.length
      ? brand.candidates.primaries
      : [brand?.colors?.primary ?? "#e14d1a"]
  const primaries = [...new Set([brand?.colors?.primary, ...rawPrimaries].filter(Boolean) as string[])]

  // Same for backgrounds: prepend the current bg so the initial selection always has a swatch.
  const rawBackgrounds =
    brand?.candidates?.backgrounds?.length
      ? brand.candidates.backgrounds
      : FALLBACK_BGS
  const backgrounds = [...new Set([brand?.colors?.bg, ...rawBackgrounds].filter(Boolean) as string[])]

  const [bg, setBg] = useState<string>(brand?.colors?.bg ?? backgrounds[0])
  const [primary, setPrimary] = useState<string>(
    brand?.colors?.primary ?? primaries[0]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Gate on the CURRENT pick, not on the nearestAA suggestion.
  const passes = meetsAA(primary, bg)
  const fixed = passes ? primary : nearestAA(primary, bg)

  function applyTheme(p: string, b: string) {
    const root = document.documentElement
    root.style.setProperty("--mate-primary", p)
    root.style.setProperty("--mate-bg", b)
    root.style.setProperty("--mate-accent", deriveAccent(p))
  }

  function pickBg(hex: string) {
    setBg(hex)
    if (meetsAA(primary, hex)) applyTheme(primary, hex)
  }
  function pickPrimary(hex: string) {
    setPrimary(hex)
    if (meetsAA(hex, bg)) applyTheme(hex, bg)
  }
  function fixForMe() {
    setPrimary(fixed)
    // Only re-theme if the fixed combo actually passes — nearestAA can still
    // fail on mid-tone backgrounds (the disabled confirm is the safety net).
    if (meetsAA(fixed, bg)) applyTheme(fixed, bg)
  }

  async function confirm() {
    if (!passes || saving) return
    setSaving(true)
    setError(null)
    try {
      const accent = deriveAccent(primary)
      // Persist the confirmed palette on the session's brand AND flag the
      // required field. Two calls share the PATCH endpoint.
      const res = await fetch("/api/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sessionId,
          brand: {
            ...(brand ?? {}),
            colors: { ...(brand?.colors ?? {}), primary, bg, accent, source: "picked" },
          },
        }),
      })
      if (!res.ok) throw new Error("Could not save your colors. Try again.")
      await saveCollected(sessionId, { brand_colors_confirmed: true })
      applyTheme(primary, bg)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your colors.")
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <p style={cardStyles.saved}>
        <CheckCircle size={16} weight="fill" /> Colors locked in.
      </p>
    )
  }

  const swatch = (hex: string, selected: boolean, onClick: () => void) => (
    <button
      key={hex}
      type="button"
      onClick={onClick}
      aria-label={`Color ${hex}`}
      aria-pressed={selected}
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        background: hex,
        cursor: "pointer",
        border: selected ? "2px solid #ffffff" : "2px solid #333333",
        boxShadow: selected ? `0 0 0 2px ${hex}` : "none",
      }}
    />
  )

  return (
    <div style={cardStyles.card}>
      <CardHead icon={<Palette size={20} weight="fill" />} title="Your colors" />
      <p style={cardStyles.why}>
        These came from your website. Pick your background and your main color
        so everything stays easy to read.
      </p>

      <div>
        <span style={cardStyles.label}>Background</span>
        <div style={cardStyles.chipRow}>
          {backgrounds.map((hex) => swatch(hex, hex === bg, () => pickBg(hex)))}
        </div>
      </div>

      <div>
        <span style={cardStyles.label}>Main color</span>
        <div style={cardStyles.chipRow}>
          {primaries.map((hex) => swatch(hex, hex === primary, () => pickPrimary(hex)))}
        </div>
      </div>

      <div
        style={{
          background: bg,
          color: primary,
          border: "1px solid #333333",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 14,
        }}
      >
        Preview: your assistant will look like this.{" "}
        <b>Book an estimate</b>
      </div>

      {!passes && (
        <>
          <p style={cardStyles.error}>
            Hard to read together (contrast {contrastRatio(primary, bg).toFixed(1)}
            :1, needs 4.5:1). Try another swatch, or let us brighten yours.
          </p>
          <button type="button" onClick={fixForMe} style={cardStyles.ghostBtn}>
            <MagicWand size={16} /> Fix it for me
          </button>
        </>
      )}

      {error && <p style={cardStyles.error}>{error}</p>}

      <button
        type="button"
        onClick={confirm}
        disabled={!passes || saving || !!streaming}
        style={{
          ...cardStyles.confirmBtn,
          ...(!passes || saving || !!streaming ? cardStyles.confirmBtnDisabled : {}),
        }}
      >
        <CheckCircle size={16} weight="fill" />
        These are my colors
      </button>
    </div>
  )
}
