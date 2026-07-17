"use client"

import { useMemo, useState } from "react"
import { CheckCircle } from "@phosphor-icons/react"
import type { CompanyData } from "@/lib/research/website"
import ServicesCard from "./ServicesCard"
import BrandVoiceCard from "./BrandVoiceCard"
import PhoneForwardCard from "./PhoneForwardCard"
import LeadDeliveryCard from "./LeadDeliveryCard"
import { cardStyles } from "./card-ui"

/**
 * CardRail — the guided sequence of structured action cards that sits beside
 * Mate's chat during onboarding.
 *
 * Phase-1 simple: a linear progression (services -> brand voice -> phone
 * forward -> lead delivery). Each card is pre-filled from research where
 * possible and saves on confirm. The active card is the first required field
 * still missing from `collected` (so a reload resumes mid-rail), and Mate's
 * chat can also fill any of these fields conversationally, which advances the
 * rail on the next load. When all four are done the rail reports completion so
 * the page can advance the session step to 'ready'.
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

type CardKey = "services" | "brand_voice" | "phone_forward" | "lead_delivery"

const ORDER: CardKey[] = ["services", "brand_voice", "phone_forward", "lead_delivery"]

const LABELS: Record<CardKey, string> = {
  services: "Services",
  brand_voice: "Voice",
  phone_forward: "Phone",
  lead_delivery: "Lead number",
}

/** A card is satisfied when its required collected field(s) are present. */
function isDone(key: CardKey, c: CollectedShape): boolean {
  switch (key) {
    case "services":
      return Array.isArray(c.services) && c.services.length > 0
    case "brand_voice":
      return typeof c.brand_voice === "string" && c.brand_voice.trim() !== ""
    case "phone_forward":
      return typeof c.current_phone === "string" && c.current_phone.trim() !== ""
    case "lead_delivery":
      return (
        typeof c.lead_delivery_phone === "string" &&
        c.lead_delivery_phone.trim() !== ""
      )
  }
}

export default function CardRail({
  sessionId,
  initialCollected,
  onAllDone,
}: {
  sessionId: string
  initialCollected: CollectedShape
  onAllDone: () => void
}) {
  // Track collected locally so confirming a card advances the rail without a
  // round-trip reload. Seeded from the server-loaded collected.
  const [collected, setCollected] = useState<CollectedShape>(initialCollected)
  const company = collected.company

  const activeKey = useMemo<CardKey | null>(() => {
    for (const key of ORDER) {
      if (!isDone(key, collected)) return key
    }
    return null
  }, [collected])

  function merge(patch: Partial<CollectedShape>) {
    setCollected((prev) => {
      const next = { ...prev, ...patch }
      // If that was the last outstanding card, tell the page.
      if (ORDER.every((k) => isDone(k, next))) {
        onAllDone()
      }
      return next
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 560 }}>
      {/* Progress dots for the four steps. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ORDER.map((key) => {
          const done = isDone(key, collected)
          const active = key === activeKey
          return (
            <span
              key={key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 999,
                border: `1px solid ${done ? "var(--mate-primary, #e14d1a)" : active ? "#4a4a4a" : "#2a2a2a"}`,
                background: done
                  ? "color-mix(in srgb, var(--mate-primary, #e14d1a) 12%, transparent)"
                  : "transparent",
                color: done ? "var(--mate-accent, #ede6e6)" : "#8a8a8a",
              }}
            >
              {done && <CheckCircle size={13} weight="fill" style={{ color: "var(--mate-primary, #e14d1a)" }} />}
              {LABELS[key]}
            </span>
          )
        })}
      </div>

      {activeKey === "services" && (
        <ServicesCard
          sessionId={sessionId}
          initialServices={collected.services ?? company?.services}
          initialPricing={collected.services_pricing}
          initialQualify={collected.qualify_criteria}
          onDone={({ services }) => merge({ services })}
        />
      )}

      {activeKey === "brand_voice" && (
        <BrandVoiceCard
          sessionId={sessionId}
          initialVoice={collected.brand_voice}
          onDone={({ brand_voice }) => merge({ brand_voice })}
        />
      )}

      {activeKey === "phone_forward" && (
        <PhoneForwardCard
          sessionId={sessionId}
          initialCurrentPhone={collected.current_phone ?? company?.phone}
          initialPublished={collected.published}
          initialConfirmed={collected.forward_confirmed}
          onDone={({ current_phone, forward_confirmed }) =>
            merge({ current_phone, forward_confirmed })
          }
        />
      )}

      {activeKey === "lead_delivery" && (
        <LeadDeliveryCard
          sessionId={sessionId}
          initialPhone={collected.lead_delivery_phone ?? company?.phone}
          onDone={({ lead_delivery_phone }) => merge({ lead_delivery_phone })}
        />
      )}

      {activeKey === null && (
        <div style={{ ...cardStyles.card, alignItems: "center", textAlign: "center" }}>
          <CheckCircle size={28} weight="fill" style={{ color: "var(--mate-primary, #e14d1a)" }} />
          <p style={{ ...cardStyles.title, fontSize: 16 }}>You&apos;re all set</p>
          <p style={cardStyles.why}>
            Your assistant has what it needs. You can keep chatting to fine-tune
            anything.
          </p>
        </div>
      )}
    </div>
  )
}
