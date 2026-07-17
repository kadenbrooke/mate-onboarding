"use client"

import { useMemo, useState } from "react"
import { CheckCircle, Lightning } from "@phosphor-icons/react"
import type { CompanyData } from "@/lib/research/website"
import { allRequiredPresent } from "@/lib/mate/required-fields"
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
