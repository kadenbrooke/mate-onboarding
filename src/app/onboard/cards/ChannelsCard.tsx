"use client"

import { useState } from "react"
import { Broadcast, CheckCircle } from "@phosphor-icons/react"
import { cardStyles, CardHead, saveCollected } from "./card-ui"
import { annualLoss } from "@/lib/mate/loss-math"

/**
 * Lead-channels picker. The channel enum drives what the First Responder
 * watches; the two optional numbers power the deterministic loss math (never
 * LLM arithmetic) and seed the Command Center's ROI baseline. The loss math
 * itself is NOT shown in-card: it is handed up through onDone so the chat can
 * deliver it as its own big "money left on the table" moment from the agent
 * (founder directive 2026-07-19: a side note reads as skippable; a dedicated
 * message reads as a big deal).
 */

export interface LossData {
  annualLoss: number
  leadsPerWeek: number
  avgJobValue: number
}

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
  streaming,
  onDone,
}: {
  sessionId: string
  done: boolean
  /** True while the parent chat is mid-stream; disables submit to prevent concurrent card submissions. */
  streaming?: boolean
  /** lossData is non-null when both numbers were provided; the chat renders
   *  the big money moment from it. */
  onDone: (lossData: LossData | null) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [leadsPerWeek, setLeadsPerWeek] = useState("")
  const [avgJobValue, setAvgJobValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      const loss = annualLoss(lpw, ajv)
      onDone(
        loss === null
          ? null
          : { annualLoss: loss, leadsPerWeek: lpw, avgJobValue: ajv }
      )
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
            aria-pressed={selected.includes(key)}
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

      {error && <p style={cardStyles.error}>{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={selected.length === 0 || saving || !!streaming}
        style={{ ...cardStyles.confirmBtn, ...(selected.length === 0 || saving || !!streaming ? cardStyles.confirmBtnDisabled : {}) }}
      >
        <CheckCircle size={16} weight="fill" />
        That is where they come in
      </button>
    </div>
  )
}
