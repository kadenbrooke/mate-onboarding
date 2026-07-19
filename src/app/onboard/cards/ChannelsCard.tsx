"use client"

import { useState } from "react"
import { Broadcast, CheckCircle } from "@phosphor-icons/react"
import { cardStyles, CardHead, saveCollected } from "./card-ui"
import { lossMessage } from "@/lib/mate/loss-math"

/**
 * Lead-channels picker + the birth flow's value moment. The channel enum drives
 * what the First Responder watches; the two optional numbers power the
 * deterministic loss math (never LLM arithmetic) and seed the Command Center's
 * ROI baseline.
 */

export const LEAD_CHANNELS: { key: string; label: string }[] = [
  { key: "missed_calls", label: "Missed phone calls" },
  { key: "web_form", label: "Website form" },
  { key: "fb_ig_dm", label: "Facebook / Instagram DMs" },
  { key: "google_business", label: "Google Business" },
  { key: "phone_answered", label: "Calls we answer live" },
  { key: "other", label: "Other" },
]

export default function ChannelsCard({
  sessionId,
  done,
  onDone,
}: {
  sessionId: string
  done: boolean
  onDone: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [leadsPerWeek, setLeadsPerWeek] = useState("")
  const [avgJobValue, setAvgJobValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loss = lossMessage(Number(leadsPerWeek), Number(avgJobValue))

  function toggle(key: string) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  async function submit() {
    if (selected.length === 0 || saving) return
    setSaving(true)
    setError(null)
    try {
      const patch: Record<string, unknown> = { lead_channels: selected }
      const lpw = Number(leadsPerWeek)
      const ajv = Number(avgJobValue)
      if (Number.isFinite(lpw) && lpw > 0) patch.leads_per_week = String(lpw)
      if (Number.isFinite(ajv) && ajv > 0) patch.avg_job_value = String(ajv)
      await saveCollected(sessionId, patch)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <p style={cardStyles.saved}>
        <CheckCircle size={16} weight="fill" /> Lead channels saved.
      </p>
    )
  }

  return (
    <div style={cardStyles.card}>
      <CardHead icon={<Broadcast size={20} weight="fill" />} title="Where do leads come in?" />
      <p style={cardStyles.why}>
        Tap everything that applies. Your assistant watches these so nothing
        slips through.
      </p>

      <div style={cardStyles.chipRow}>
        {LEAD_CHANNELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            style={{ ...cardStyles.chip, ...(selected.includes(key) ? cardStyles.chipSelected : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={cardStyles.label}>Leads per week</span>
          <input style={cardStyles.input} value={leadsPerWeek} onChange={(e) => setLeadsPerWeek(e.target.value)} placeholder="12" inputMode="numeric" />
        </div>
        <div style={{ flex: 1 }}>
          <span style={cardStyles.label}>Average job value</span>
          <input style={cardStyles.input} value={avgJobValue} onChange={(e) => setAvgJobValue(e.target.value)} placeholder="4800" inputMode="numeric" />
        </div>
      </div>

      {loss && (
        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "var(--mate-accent, #ede6e6)",
            background: "color-mix(in srgb, var(--mate-primary, #e14d1a) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--mate-primary, #e14d1a) 35%, transparent)",
            borderRadius: 10,
            padding: "11px 13px",
            margin: 0,
          }}
        >
          {loss}
        </p>
      )}

      {error && <p style={cardStyles.error}>{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={selected.length === 0 || saving}
        style={{ ...cardStyles.confirmBtn, ...(selected.length === 0 || saving ? cardStyles.confirmBtnDisabled : {}) }}
      >
        <CheckCircle size={16} weight="fill" />
        That is where they come in
      </button>
    </div>
  )
}
