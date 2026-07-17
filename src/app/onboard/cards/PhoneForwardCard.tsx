"use client"

import { useState } from "react"
import { PhoneOutgoing, Check } from "@phosphor-icons/react"
import { CardHead, cardStyles, saveCollected } from "./card-ui"
import { isValidPhone, normalizePhone } from "./phone"

/**
 * PhoneForwardCard — set up call forwarding to the new number.
 *
 * Carrier-agnostic guidance (short, accurate, no em dashes), the number leads
 * call/text today, an optional "where is it published" set (parity with the
 * static intake `published` channels), and an "I've set this up" confirm.
 *
 * On confirm saves:
 *   collected.current_phone     (string, normalized)
 *   collected.forward_confirmed (boolean)
 *   collected.published         (string[], optional)
 */

const CHANNELS: { value: string; label: string }[] = [
  { value: "websites", label: "Website(s)" },
  { value: "ads", label: "Paid ads" },
  { value: "gbp", label: "Google Business" },
  { value: "cards", label: "Business cards" },
  { value: "signage", label: "Vehicle / signage" },
]

export default function PhoneForwardCard({
  sessionId,
  initialCurrentPhone,
  initialPublished,
  initialConfirmed,
  onDone,
}: {
  sessionId: string
  initialCurrentPhone?: string
  initialPublished?: string[]
  initialConfirmed?: boolean
  onDone: (value: { current_phone: string; forward_confirmed: boolean }) => void
}) {
  const [phone, setPhone] = useState(initialCurrentPhone ?? "")
  const [published, setPublished] = useState<string[]>(initialPublished ?? [])
  const [confirmed, setConfirmed] = useState<boolean>(initialConfirmed ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleChannel(value: string) {
    setPublished((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  async function confirm() {
    if (saving) return
    if (phone.trim() === "") {
      setError("Enter the number leads call or text today.")
      return
    }
    if (!isValidPhone(phone)) {
      setError("That doesn't look like a valid phone number.")
      return
    }
    if (!confirmed) {
      setError("Tick the box once you've set up forwarding, or you can do it later.")
      return
    }
    setError(null)
    setSaving(true)
    try {
      await saveCollected(sessionId, {
        current_phone: normalizePhone(phone),
        forward_confirmed: confirmed,
        ...(published.length > 0 ? { published } : {}),
      })
      onDone({ current_phone: normalizePhone(phone), forward_confirmed: confirmed })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={cardStyles.card}>
      <CardHead
        icon={<PhoneOutgoing size={20} weight="fill" />}
        title="Forward your calls"
      />
      <p style={cardStyles.why}>
        Point missed and after-hours calls to your new number so a lead is never
        met with silence. Your existing number stays yours and keeps working.
      </p>

      <div
        style={{
          background: "#0f0f0f",
          border: "1px solid #333333",
          borderRadius: 10,
          padding: "12px 13px",
          fontSize: 13,
          lineHeight: 1.55,
          color: "#c4bebe",
        }}
      >
        <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--mate-accent, #ede6e6)" }}>
          How to forward on most carriers
        </p>
        <p style={{ margin: 0 }}>
          From your business phone, dial the forwarding code, then your new number,
          then call. Common codes:
        </p>
        <ul style={{ margin: "6px 0 6px 18px", padding: 0 }}>
          <li>Forward when unanswered: dial *61* then the new number then #</li>
          <li>Forward when busy: dial *67* then the new number then #</li>
          <li>Forward everything: dial *72 then the new number (turn off with *73)</li>
        </ul>
        <p style={{ margin: 0 }}>
          Codes vary a little by carrier. If a code does not take, search your
          carrier&apos;s name plus &quot;call forwarding&quot;, or we can walk you
          through it. You can also skip this now and confirm later.
        </p>
      </div>

      <div>
        <label style={cardStyles.label}>The number leads call or text today</label>
        <p style={cardStyles.hint}>
          Your main business line. It keeps working untouched for everyone who
          already has it.
        </p>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(385) 000-0000"
          style={{ ...cardStyles.input, ...(error && !isValidPhone(phone) ? cardStyles.inputError : {}) }}
          aria-label="Current phone number"
        />
      </div>

      <div>
        <label style={cardStyles.label}>Where is that number published? (optional)</label>
        <p style={cardStyles.hint}>
          Tells us where to place your new number versus leave the current one
          alone.
        </p>
        <div style={cardStyles.chipRow}>
          {CHANNELS.map((c) => {
            const selected = published.includes(c.value)
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggleChannel(c.value)}
                style={{ ...cardStyles.chip, ...(selected ? cardStyles.chipSelected : {}) }}
                aria-pressed={selected}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 9,
          fontSize: 14,
          color: "var(--mate-accent, #ede6e6)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          style={{ marginTop: 3, accentColor: "var(--mate-primary, #e14d1a)" }}
        />
        <span>I&apos;ve set up call forwarding to my new number.</span>
      </label>

      {error && <p style={cardStyles.error}>{error}</p>}

      <button
        type="button"
        onClick={confirm}
        disabled={saving}
        style={{ ...cardStyles.confirmBtn, ...(saving ? cardStyles.confirmBtnDisabled : {}) }}
      >
        <Check size={16} weight="bold" />
        {saving ? "Saving..." : "Confirm phone setup"}
      </button>
    </div>
  )
}
