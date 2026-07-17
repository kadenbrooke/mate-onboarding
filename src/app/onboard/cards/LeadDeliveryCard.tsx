"use client"

import { useState } from "react"
import { PaperPlaneTilt, Check } from "@phosphor-icons/react"
import { CardHead, cardStyles, saveCollected } from "./card-ui"
import { isValidPhone, normalizePhone } from "./phone"

/**
 * LeadDeliveryCard — the cell where warm leads get texted the moment they come
 * in. Pre-filled from the researched company phone if present. Validates an
 * E.164-ish number and shows an inline error before it will save.
 *
 * On confirm saves collected.lead_delivery_phone (string, normalized).
 */
export default function LeadDeliveryCard({
  sessionId,
  initialPhone,
  onDone,
}: {
  sessionId: string
  initialPhone?: string
  onDone: (value: { lead_delivery_phone: string }) => void
}) {
  const [phone, setPhone] = useState(initialPhone ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalid = phone.trim() !== "" && !isValidPhone(phone)

  async function confirm() {
    if (saving) return
    if (phone.trim() === "") {
      setError("Enter the cell where warm leads should be texted.")
      return
    }
    if (!isValidPhone(phone)) {
      setError("That doesn't look like a valid phone number.")
      return
    }
    setError(null)
    setSaving(true)
    try {
      const value = normalizePhone(phone)
      await saveCollected(sessionId, { lead_delivery_phone: value })
      onDone({ lead_delivery_phone: value })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={cardStyles.card}>
      <CardHead
        icon={<PaperPlaneTilt size={20} weight="fill" />}
        title="Where leads reach you"
      />
      <p style={cardStyles.why}>
        The second a lead comes in, your assistant texts it to this cell so you
        can follow up fast. This is where the money lands.
      </p>

      <div>
        <label style={cardStyles.label}>Best cell for instant lead alerts</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              confirm()
            }
          }}
          placeholder="(385) 000-0000"
          style={{ ...cardStyles.input, ...(invalid || (error && !isValidPhone(phone)) ? cardStyles.inputError : {}) }}
          aria-label="Lead delivery phone number"
          aria-invalid={invalid}
        />
        {invalid && (
          <p style={{ ...cardStyles.error, marginTop: 6 }}>
            That doesn&apos;t look like a valid phone number.
          </p>
        )}
      </div>

      {error && <p style={cardStyles.error}>{error}</p>}

      <button
        type="button"
        onClick={confirm}
        disabled={saving}
        style={{ ...cardStyles.confirmBtn, ...(saving ? cardStyles.confirmBtnDisabled : {}) }}
      >
        <Check size={16} weight="bold" />
        {saving ? "Saving..." : "Confirm lead number"}
      </button>
    </div>
  )
}
