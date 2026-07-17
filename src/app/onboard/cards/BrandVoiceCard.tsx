"use client"

import { useState } from "react"
import { ChatCircleText, Check } from "@phosphor-icons/react"
import { CardHead, cardStyles, saveCollected } from "./card-ui"

/**
 * BrandVoiceCard — how the assistant should sound when it talks to leads.
 *
 * A few tone presets (one-tap) plus a free-text override. Selecting a preset
 * fills the text so the owner can tweak it; anything typed wins. On confirm
 * saves collected.brand_voice (string).
 */

const PRESETS = [
  "Friendly and casual",
  "Professional but warm",
  "Straight to the point",
  "Upbeat and energetic",
]

export default function BrandVoiceCard({
  sessionId,
  initialVoice,
  onDone,
}: {
  sessionId: string
  initialVoice?: string
  onDone: (value: { brand_voice: string }) => void
}) {
  const [voice, setVoice] = useState(initialVoice ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function selectPreset(preset: string) {
    setVoice(preset)
  }

  async function confirm() {
    if (saving) return
    const value = voice.trim()
    if (value === "") {
      setError("Pick a tone or describe how it should sound.")
      return
    }
    setError(null)
    setSaving(true)
    try {
      await saveCollected(sessionId, { brand_voice: value })
      onDone({ brand_voice: value })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  const current = voice.trim()

  return (
    <div style={cardStyles.card}>
      <CardHead
        icon={<ChatCircleText size={20} weight="fill" />}
        title="How it should sound"
      />
      <p style={cardStyles.why}>
        This shapes your assistant&apos;s voice when it greets and qualifies a
        lead. It still hands the lead to you warm. Pick a starting tone, then
        tweak the words.
      </p>

      <div style={cardStyles.chipRow}>
        {PRESETS.map((preset) => {
          const selected = current.toLowerCase() === preset.toLowerCase()
          return (
            <button
              key={preset}
              type="button"
              onClick={() => selectPreset(preset)}
              style={{ ...cardStyles.chip, ...(selected ? cardStyles.chipSelected : {}) }}
              aria-pressed={selected}
            >
              {preset}
            </button>
          )
        })}
      </div>

      <div>
        <label style={cardStyles.label}>Describe it in your words</label>
        <textarea
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          placeholder="e.g. friendly and casual, never pushy, always confirms the next step"
          style={cardStyles.textarea}
          aria-label="Brand voice"
        />
      </div>

      {error && <p style={cardStyles.error}>{error}</p>}

      <button
        type="button"
        onClick={confirm}
        disabled={saving}
        style={{ ...cardStyles.confirmBtn, ...(saving ? cardStyles.confirmBtnDisabled : {}) }}
      >
        <Check size={16} weight="bold" />
        {saving ? "Saving..." : "Confirm voice"}
      </button>
    </div>
  )
}
