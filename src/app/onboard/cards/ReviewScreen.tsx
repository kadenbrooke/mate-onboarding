"use client"

import { useMemo, useState } from "react"
import { CheckCircle, Lightning } from "@phosphor-icons/react"
import type { CompanyData } from "@/lib/research/website"
import { allRequiredPresent, missingRequired, REQUIRED_LABELS } from "@/lib/mate/required-fields"
import { LEAD_CHANNELS } from "./ChannelsCard"
import { saveCollected } from "./card-ui"
import ServicesCard from "./ServicesCard"
import BrandVoiceCard from "./BrandVoiceCard"
import PhoneForwardCard from "./PhoneForwardCard"
import LeadDeliveryCard from "./LeadDeliveryCard"

// Re-export the shared completion helpers so callers can keep importing them
// from the review screen if they prefer; the source of truth is the pure lib
// module (testable, no React).
export { REQUIRED_KEYS, allRequiredPresent } from "@/lib/mate/required-fields"

/**
 * ReviewScreen — the single confirmation screen shown AFTER the client has been
 * all the way through Mate's chat.
 *
 * Unlike the old gated card rail, this shows all four structured fields at once,
 * pre-filled from everything Mate collected in the conversation, each still
 * editable for a final change. Every edit saves through the same /api/session
 * PATCH whitelist the cards always used, so persistence is unchanged. A single
 * "Confirm and finish" action completes onboarding (provision + reveal). A short
 * ability note ties the lead number to the value it unlocks, tastefully.
 */

export type CollectedShape = {
  company?: CompanyData
  services?: string[]
  services_pricing?: string
  qualify_criteria?: string
  brand_voice?: string
  current_phone?: string
  forward_confirmed?: boolean
  published?: string[]
  lead_delivery_phone?: string
  brand_colors_confirmed?: boolean
  legal_business_name?: string
  ein?: string
  business_address?: string
  entity_type?: string
  lead_channels?: string[]
  leads_per_week?: string
  avg_job_value?: string
  website_editor_name?: string
  website_editor_contact?: string
  website_can_edit?: string
} & Record<string, unknown>

const S = {
  wrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
    width: "100%",
    maxWidth: 560,
  } as React.CSSProperties,
  header: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } as React.CSSProperties,
  heading: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    fontWeight: 700,
    color: "var(--mate-accent, #ede6e6)",
    margin: 0,
  } as React.CSSProperties,
  sub: {
    fontSize: 14,
    color: "#9a9a9a",
    margin: 0,
    lineHeight: 1.5,
  } as React.CSSProperties,
  // A light accent line tying a field to the ability it unlocks. Minimal, not a
  // wall: brand-tinted icon + one honest sentence.
  ability: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "#9a9a9a",
    margin: "-4px 2px 0",
  } as React.CSSProperties,
  abilityIcon: {
    color: "var(--mate-primary, #e14d1a)",
    flexShrink: 0,
    marginTop: 1,
  } as React.CSSProperties,
  confirmBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "var(--mate-primary, #e14d1a)",
    color: "#ffffff",
    border: "none",
    borderRadius: 12,
    padding: "15px 18px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "var(--font-display)",
    width: "100%",
  } as React.CSSProperties,
  confirmBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  } as React.CSSProperties,
  gate: {
    fontSize: 12.5,
    color: "#f5a97f",
    margin: 0,
    textAlign: "center" as const,
  } as React.CSSProperties,
}

/** A short, honest "what this unlocks" line under a field. */
function AbilityNote({ text }: { text: string }) {
  return (
    <p style={S.ability}>
      <Lightning size={14} weight="fill" style={S.abilityIcon} />
      <span>{text}</span>
    </p>
  )
}

export default function ReviewScreen({
  sessionId,
  initialCollected,
  onConfirm,
}: {
  sessionId: string
  initialCollected: CollectedShape
  onConfirm: () => void
}) {
  // Track collected locally so an edit reflects immediately (the completeness
  // gate flips live). Seeded from the server-loaded collected passed in.
  const [collected, setCollected] = useState<CollectedShape>(initialCollected)
  const company = collected.company

  const ready = useMemo(() => allRequiredPresent(collected), [collected])

  function merge(patch: Partial<CollectedShape>) {
    setCollected((prev) => ({ ...prev, ...patch }))
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <h1 style={S.heading}>Here&apos;s what we&apos;ve got</h1>
        <p style={S.sub}>
          Change anything below, then confirm. This is what your assistant will
          use from day one.
        </p>
      </div>

      {!ready && (
        <div
          style={{
            border: "1px solid #f5a97f",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 13,
            color: "#f5a97f",
            lineHeight: 1.5,
          }}
        >
          Still needed before your assistant can go live:{" "}
          {missingRequired(collected).map((k) => REQUIRED_LABELS[k]).join(", ")}
        </div>
      )}

      <ColorsReview collected={collected} />

      <ServicesCard
        sessionId={sessionId}
        initialServices={collected.services ?? company?.services}
        initialPricing={collected.services_pricing}
        initialQualify={collected.qualify_criteria}
        onDone={({ services }) => merge({ services })}
      />
      <AbilityNote text="These are what your assistant talks to every lead about." />

      <BrandVoiceCard
        sessionId={sessionId}
        initialVoice={collected.brand_voice}
        onDone={({ brand_voice }) => merge({ brand_voice })}
      />
      <AbilityNote text="Your assistant greets and qualifies leads in this voice, then hands them to you warm." />

      <PhoneForwardCard
        sessionId={sessionId}
        initialCurrentPhone={collected.current_phone ?? company?.phone}
        initialPublished={collected.published}
        initialConfirmed={collected.forward_confirmed}
        onDone={({ current_phone, forward_confirmed }) =>
          merge({ current_phone, forward_confirmed })
        }
      />
      <AbilityNote text="Missed and after-hours calls forward here so a lead is never met with silence." />

      <LeadDeliveryCard
        sessionId={sessionId}
        initialPhone={collected.lead_delivery_phone ?? company?.phone}
        onDone={({ lead_delivery_phone }) => merge({ lead_delivery_phone })}
      />
      <AbilityNote text="This is where your instant missed-call text-backs and lead alerts will land." />

      <RegistrationReview collected={collected} sessionId={sessionId} onMerge={merge} />
      <AbilityNote text="Carriers require this so your assistant can text legally." />

      <ChannelsReview collected={collected} sessionId={sessionId} onMerge={merge} />
      <AbilityNote text="Your assistant watches these channels so nothing slips through." />

      {!ready && (
        <p style={S.gate}>
          Confirm each card above (look for the green check) to finish.
        </p>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={!ready}
        style={{ ...S.confirmBtn, ...(ready ? {} : S.confirmBtnDisabled) }}
      >
        <CheckCircle size={18} weight="fill" />
        Confirm and finish
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components (defined in this file; review-only editors, not chat cards)
// ---------------------------------------------------------------------------

/** Compact colors row: two swatches + confirmed check. No re-picker on review. */
function ColorsReview({ collected }: { collected: CollectedShape }) {
  const confirmed = collected.brand_colors_confirmed === true
  return (
    <div style={{ ...reviewCardStyle, ...(confirmed ? {} : missingStyle) }}>
      <h2 style={S.heading as React.CSSProperties}>Brand colors</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          aria-label="Background color"
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "var(--mate-bg, #141414)",
            border: "1px solid #444444",
            flexShrink: 0,
          }}
        />
        <div
          aria-label="Primary color"
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "var(--mate-primary, #e14d1a)",
            border: "1px solid #444444",
            flexShrink: 0,
          }}
        />
        {confirmed ? (
          <span style={{ fontSize: 13, color: "#7fd39b", display: "flex", alignItems: "center", gap: 5 }}>
            <CheckCircle size={15} weight="fill" /> Confirmed in chat
          </span>
        ) : (
          <span style={{ fontSize: 13, color: "#f5a97f" }}>
            Not confirmed yet. Return to chat to pick your colors.
          </span>
        )}
      </div>
    </div>
  )
}

function RegistrationReview({
  collected,
  sessionId,
  onMerge,
}: {
  collected: CollectedShape
  sessionId: string
  onMerge: (patch: Partial<CollectedShape>) => void
}) {
  const [legalName, setLegalName] = useState(collected.legal_business_name ?? "")
  const [ein, setEin] = useState("") // never pre-fill the masked value into an editable field
  const [address, setAddress] = useState(collected.business_address ?? "")
  const [entityType, setEntityType] = useState(collected.entity_type ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const einSaved = typeof collected.ein === "string" && collected.ein !== ""

  const missing = !collected.legal_business_name || !einSaved || !collected.business_address || !collected.entity_type

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const patch: Record<string, unknown> = {}
      if (legalName.trim()) patch.legal_business_name = legalName.trim()
      const einDigits = ein.replace(/\D/g, "")
      if (einDigits.length === 9) patch.ein = einDigits
      if (address.trim()) patch.business_address = address.trim()
      if (entityType) patch.entity_type = entityType
      await saveCollected(sessionId, patch)
      onMerge(patch as Partial<CollectedShape>)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ ...reviewCardStyle, ...(missing ? missingStyle : {}) }}>
      <h2 style={S.heading as React.CSSProperties}>Business registration</h2>
      <label style={fieldLabel}>Legal business name</label>
      <input style={fieldInput} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
      <label style={fieldLabel}>EIN {einSaved ? `(saved: ${collected.ein})` : ""}</label>
      <input
        style={fieldInput}
        value={ein}
        onChange={(e) => setEin(e.target.value)}
        placeholder={einSaved ? "Enter only to change" : "12-3456789"}
        inputMode="numeric"
      />
      <label style={fieldLabel}>Business address</label>
      <input style={fieldInput} value={address} onChange={(e) => setAddress(e.target.value)} />
      <label style={fieldLabel}>Entity type</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {["LLC", "Corporation", "Sole Proprietor", "Partnership"].map((t) => (
          <button key={t} type="button" onClick={() => setEntityType(t)} style={{ ...chipStyle, ...(entityType === t ? chipSelectedStyle : {}) }}>{t}</button>
        ))}
      </div>
      {error && <p style={{ color: "#f5a97f", fontSize: 12.5, margin: 0 }}>{error}</p>}
      <button type="button" onClick={save} disabled={saving} style={saveBtnStyle}>Save</button>
    </div>
  )
}

function ChannelsReview({
  collected,
  sessionId,
  onMerge,
}: {
  collected: CollectedShape
  sessionId: string
  onMerge: (patch: Partial<CollectedShape>) => void
}) {
  const [selectedChannels, setSelectedChannels] = useState<string[]>(collected.lead_channels ?? [])
  const [editorName, setEditorName] = useState(collected.website_editor_name ?? "")
  const [editorContact, setEditorContact] = useState(collected.website_editor_contact ?? "")
  const [canEdit, setCanEdit] = useState(collected.website_can_edit ?? "")
  const [leadsPerWeek, setLeadsPerWeek] = useState(collected.leads_per_week ?? "")
  const [avgJobValue, setAvgJobValue] = useState(collected.avg_job_value ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missing = !collected.lead_channels?.length || !collected.website_editor_contact

  function toggleChannel(key: string) {
    setSelectedChannels((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const patch: Record<string, unknown> = {}
      if (selectedChannels.length > 0) patch.lead_channels = selectedChannels
      if (editorName.trim()) patch.website_editor_name = editorName.trim()
      if (editorContact.trim()) patch.website_editor_contact = editorContact.trim()
      if (canEdit) patch.website_can_edit = canEdit
      if (leadsPerWeek.trim()) patch.leads_per_week = leadsPerWeek.trim()
      if (avgJobValue.trim()) patch.avg_job_value = avgJobValue.trim()
      await saveCollected(sessionId, patch)
      onMerge(patch as Partial<CollectedShape>)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ ...reviewCardStyle, ...(missing ? missingStyle : {}) }}>
      <h2 style={S.heading as React.CSSProperties}>Channels and website</h2>

      <label style={fieldLabel}>Lead channels</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {LEAD_CHANNELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleChannel(key)}
            style={{ ...chipStyle, ...(selectedChannels.includes(key) ? chipSelectedStyle : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      <label style={fieldLabel}>Website editor name</label>
      <input style={fieldInput} value={editorName} onChange={(e) => setEditorName(e.target.value)} placeholder="Ben" />

      <label style={fieldLabel}>Website editor contact</label>
      <input style={fieldInput} value={editorContact} onChange={(e) => setEditorContact(e.target.value)} placeholder="ben@example.com" />

      <label style={fieldLabel}>Client can edit site</label>
      <div style={{ display: "flex", gap: 8 }}>
        {["yes", "no"].map((v) => (
          <button key={v} type="button" onClick={() => setCanEdit(v)} style={{ ...chipStyle, ...(canEdit === v ? chipSelectedStyle : {}) }}>{v}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={fieldLabel}>Leads per week</label>
          <input style={fieldInput} value={leadsPerWeek} onChange={(e) => setLeadsPerWeek(e.target.value)} placeholder="12" inputMode="numeric" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={fieldLabel}>Average job value</label>
          <input style={fieldInput} value={avgJobValue} onChange={(e) => setAvgJobValue(e.target.value)} placeholder="4800" inputMode="numeric" />
        </div>
      </div>

      {error && <p style={{ color: "#f5a97f", fontSize: 12.5, margin: 0 }}>{error}</p>}
      <button type="button" onClick={save} disabled={saving} style={saveBtnStyle}>Save</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const reviewCardStyle: React.CSSProperties = {
  background: "#1a1a1a", border: "1px solid #333333", borderRadius: 16,
  padding: "20px 18px", display: "flex", flexDirection: "column", gap: 10,
}
const missingStyle: React.CSSProperties = { borderColor: "#f5a97f" }
const fieldLabel: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--mate-accent, #ede6e6)" }
const fieldInput: React.CSSProperties = {
  width: "100%", background: "#0f0f0f", border: "1px solid #333333", borderRadius: 10,
  padding: "11px 13px", color: "var(--mate-accent, #ede6e6)", fontSize: 15, outline: "none",
}
const chipStyle: React.CSSProperties = {
  fontSize: 13, padding: "7px 12px", borderRadius: 999, border: "1px solid #333333",
  background: "#0f0f0f", color: "var(--mate-accent, #ede6e6)", cursor: "pointer",
}
const chipSelectedStyle: React.CSSProperties = {
  borderColor: "var(--mate-primary, #e14d1a)",
  background: "color-mix(in srgb, var(--mate-primary, #e14d1a) 12%, transparent)",
}
const saveBtnStyle: React.CSSProperties = {
  alignSelf: "flex-start", background: "var(--mate-primary, #e14d1a)", color: "#ffffff",
  border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
}
