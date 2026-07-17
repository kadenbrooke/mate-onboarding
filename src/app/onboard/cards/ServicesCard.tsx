"use client"

import { useState } from "react"
import { Wrench, Plus, X, Check } from "@phosphor-icons/react"
import { CardHead, cardStyles, saveCollected } from "./card-ui"

/**
 * ServicesCard — confirm the services the business offers.
 *
 * Pre-filled from research (collected.company.services), fully editable:
 * add/remove chips. Optional rough pricing and optional qualify criteria are
 * captured here too, since both describe "what the assistant handles / how it
 * screens a lead" and keep parity with the static intake form
 * (agent qualify_criteria) without a separate card.
 *
 * On confirm saves:
 *   collected.services            (string[])
 *   collected.services_pricing    (string, optional)
 *   collected.qualify_criteria    (string, optional)
 */
export default function ServicesCard({
  sessionId,
  initialServices,
  initialPricing,
  initialQualify,
  onDone,
}: {
  sessionId: string
  initialServices?: string[]
  initialPricing?: string
  initialQualify?: string
  onDone: (value: { services: string[] }) => void
}) {
  const [services, setServices] = useState<string[]>(
    () => (initialServices ?? []).filter((s) => s && s.trim() !== "")
  )
  const [draft, setDraft] = useState("")
  const [pricing, setPricing] = useState(initialPricing ?? "")
  const [qualify, setQualify] = useState(initialQualify ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addService(raw: string) {
    const value = raw.trim()
    if (value === "") return
    // Case-insensitive dedupe so "Paving" and "paving" do not both land.
    if (services.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setDraft("")
      return
    }
    setServices((prev) => [...prev, value])
    setDraft("")
  }

  function removeService(index: number) {
    setServices((prev) => prev.filter((_, i) => i !== index))
  }

  async function confirm() {
    if (saving) return
    if (services.length === 0) {
      setError("Add at least one service so your assistant knows what you do.")
      return
    }
    setError(null)
    setSaving(true)
    try {
      await saveCollected(sessionId, {
        services,
        ...(pricing.trim() !== "" ? { services_pricing: pricing.trim() } : {}),
        ...(qualify.trim() !== "" ? { qualify_criteria: qualify.trim() } : {}),
      })
      onDone({ services })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={cardStyles.card}>
      <CardHead icon={<Wrench size={20} weight="fill" />} title="Your services" />
      <p style={cardStyles.why}>
        These are what your assistant offers to talk to leads about. We pulled a
        starting list from your site. Add or remove anything.
      </p>

      <div>
        <div style={cardStyles.chipRow}>
          {services.map((s, i) => (
            <span key={`${s}-${i}`} style={{ ...cardStyles.chip, ...cardStyles.chipSelected }}>
              {s}
              <button
                type="button"
                onClick={() => removeService(i)}
                style={cardStyles.removeBtn}
                aria-label={`Remove ${s}`}
              >
                <X size={13} weight="bold" />
              </button>
            </span>
          ))}
          {services.length === 0 && (
            <span style={{ ...cardStyles.why, margin: 0 }}>No services yet. Add one below.</span>
          )}
        </div>

        <div style={{ ...cardStyles.addRow, marginTop: 10 }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addService(draft)
              }
            }}
            placeholder="Add a service"
            style={cardStyles.input}
            aria-label="Add a service"
          />
          <button
            type="button"
            onClick={() => addService(draft)}
            style={cardStyles.ghostBtn}
            aria-label="Add service"
            disabled={draft.trim() === ""}
          >
            <Plus size={16} weight="bold" />
            Add
          </button>
        </div>
      </div>

      <div>
        <label style={cardStyles.label}>Rough pricing (optional)</label>
        <p style={cardStyles.hint}>
          A ballpark so your assistant can set expectations. Skip if you would
          rather quote every job.
        </p>
        <input
          type="text"
          value={pricing}
          onChange={(e) => setPricing(e.target.value)}
          placeholder="e.g. driveways from $2,500"
          style={cardStyles.input}
          aria-label="Rough pricing"
        />
      </div>

      <div>
        <label style={cardStyles.label}>What should it find out from a lead? (optional)</label>
        <p style={cardStyles.hint}>
          What separates a real job from a tire-kicker: budget, timeline, project
          type, location. Helps it qualify before it reaches you.
        </p>
        <textarea
          value={qualify}
          onChange={(e) => setQualify(e.target.value)}
          placeholder="Optional"
          style={cardStyles.textarea}
          aria-label="Qualify criteria"
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
        {saving ? "Saving..." : "Confirm services"}
      </button>
    </div>
  )
}
