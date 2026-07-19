"use client"

import { useState } from "react"
import { IdentificationCard, CheckCircle } from "@phosphor-icons/react"
import { cardStyles, CardHead, saveCollected } from "./card-ui"

/**
 * 10DLC business-registration form card. Structured inputs, no LLM extraction:
 * carriers file these EXACT values (TCR brand + campaign registration), so a
 * typo here becomes a rejected filing. EIN is validated to 9 digits and stored
 * server-side only (the session GET masks it to last 4).
 */

const ENTITY_TYPES = ["LLC", "Corporation", "Sole Proprietor", "Partnership"]

/** 9 digits, tolerant of the XX-XXXXXXX display format. */
export function normalizeEin(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  return digits.length === 9 ? digits : null
}

export default function RegistrationCard({
  sessionId,
  done,
  streaming,
  onDone,
}: {
  sessionId: string
  done: boolean
  /** True while the parent chat is mid-stream; disables submit to prevent concurrent card submissions. */
  streaming?: boolean
  onDone: () => void
}) {
  const [legalName, setLegalName] = useState("")
  const [ein, setEin] = useState("")
  const [street, setStreet] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zip, setZip] = useState("")
  const [entityType, setEntityType] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const einOk = normalizeEin(ein) !== null
  const complete =
    legalName.trim() !== "" && einOk && street.trim() !== "" &&
    city.trim() !== "" && state.trim() !== "" && zip.trim() !== "" &&
    entityType !== ""

  async function submit() {
    if (!complete || saving) return
    setSaving(true)
    setError(null)
    try {
      await saveCollected(sessionId, {
        legal_business_name: legalName.trim(),
        ein: normalizeEin(ein),
        business_address: `${street.trim()}, ${city.trim()}, ${state.trim()} ${zip.trim()}`,
        entity_type: entityType,
      })
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
        <CheckCircle size={16} weight="fill" /> Registration details saved.
      </p>
    )
  }

  return (
    <div style={cardStyles.card}>
      <CardHead icon={<IdentificationCard size={20} weight="fill" />} title="Official business info" />
      <p style={cardStyles.why}>
        Carriers require every business that texts customers to be registered.
        Two minutes of official info, exactly as it appears on your paperwork,
        and your team files it for you.
      </p>

      <div>
        <label htmlFor="reg-legal-name" style={cardStyles.label}>Legal business name</label>
        <input id="reg-legal-name" style={cardStyles.input} value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="J and C Asphalt LLC" />
      </div>

      <div>
        <label htmlFor="reg-ein" style={cardStyles.label}>EIN</label>
        <p style={cardStyles.hint}>Your 9 digit federal tax ID, like 12-3456789. Kept private.</p>
        <input
          id="reg-ein"
          style={{ ...cardStyles.input, ...(ein !== "" && !einOk ? cardStyles.inputError : {}) }}
          value={ein}
          onChange={(e) => setEin(e.target.value)}
          placeholder="12-3456789"
          inputMode="numeric"
        />
        {ein !== "" && !einOk && <p style={cardStyles.error}>An EIN is 9 digits.</p>}
      </div>

      <div>
        <label htmlFor="reg-street" style={cardStyles.label}>Business address</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input id="reg-street" style={cardStyles.input} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Street address" />
          <div style={{ display: "flex", gap: 8 }}>
            <input id="reg-city" style={{ ...cardStyles.input, flex: 2 }} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
            <input id="reg-state" style={{ ...cardStyles.input, flex: 1 }} value={state} onChange={(e) => setState(e.target.value)} placeholder="State" maxLength={2} />
            <input id="reg-zip" style={{ ...cardStyles.input, flex: 1 }} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" inputMode="numeric" />
          </div>
        </div>
      </div>

      <div>
        <span style={cardStyles.label}>Entity type</span>
        <div style={cardStyles.chipRow}>
          {ENTITY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setEntityType(t)}
              aria-pressed={entityType === t}
              style={{ ...cardStyles.chip, ...(entityType === t ? cardStyles.chipSelected : {}) }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <p style={cardStyles.error}>{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!complete || saving || !!streaming}
        style={{ ...cardStyles.confirmBtn, ...(!complete || saving || !!streaming ? cardStyles.confirmBtnDisabled : {}) }}
      >
        <CheckCircle size={16} weight="fill" />
        Save official info
      </button>
    </div>
  )
}
