"use client"

import { Wrench, Info } from "@phosphor-icons/react"
import type { UnderConstructionItem } from "@/lib/portal/capabilities"

// The "Under Construction" zone: capabilities awaiting external registration
// (e.g. SMS pending 10DLC carrier vetting) or awaiting a build. Shown honestly
// with each item's reason. Never presented as a fake "live". SMS-type items get
// an extra carrier-vetting note so the wait is explained, not hidden.

/**
 * Heuristic: is this UC item SMS/text based, so the 10DLC carrier-vetting note
 * applies? Matches the seeded capability keys (first_responder_sms, fr_sms) and
 * any label mentioning text/SMS. Kept liberal — a false positive just adds a
 * true, harmless note; a false negative would hide a real explanation.
 */
function isSmsItem(item: UnderConstructionItem): boolean {
  const key = item.capability_key.toLowerCase()
  const label = item.label.toLowerCase()
  return (
    key.includes("sms") ||
    key.includes("fr_") ||
    key.includes("first_responder") ||
    key.includes("text") ||
    label.includes("text") ||
    label.includes("sms")
  )
}

const SMS_NOTE =
  "Text messaging needs carrier approval (10DLC vetting) before it can send. That review typically takes about 1 to 3 weeks. Nothing is needed from you, we handle it and this switches to Live automatically once approved."

const S = {
  panel: {
    background: "#161616",
    border: "1px solid #2a2a2a",
    borderRadius: 14,
    padding: "18px 18px 20px",
  } as React.CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  } as React.CSSProperties,
  title: {
    fontFamily: "var(--font-display)",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--mate-accent, #ede6e6)",
    margin: 0,
  } as React.CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  } as React.CSSProperties,
  item: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    padding: "10px 12px",
    background: "#1c1c1c",
    border: "1px dashed #3a3a3a",
    borderRadius: 10,
  } as React.CSSProperties,
  itemHead: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
  } as React.CSSProperties,
  itemLabel: {
    fontSize: 14,
    color: "var(--mate-accent, #ede6e6)",
    lineHeight: 1.4,
  } as React.CSSProperties,
  itemReason: {
    fontSize: 12,
    color: "#c9a15f",
    marginTop: 2,
    textTransform: "capitalize" as const,
  } as React.CSSProperties,
  note: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 4,
    padding: "8px 10px",
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    fontSize: 12,
    color: "#a0a0a0",
    lineHeight: 1.5,
  } as React.CSSProperties,
  empty: {
    fontSize: 13,
    color: "#888888",
    lineHeight: 1.5,
    margin: 0,
  } as React.CSSProperties,
}

export default function UnderConstructionPanel({
  items,
}: {
  items: UnderConstructionItem[]
}) {
  return (
    <div style={S.panel}>
      <div style={S.head}>
        <Wrench size={20} weight="fill" color="var(--mate-primary, #e14d1a)" />
        <h2 style={S.title}>Under construction</h2>
      </div>

      {items.length === 0 ? (
        <p style={S.empty}>
          Nothing is in the works right now. Ask your assistant below any time you
          want to add something new.
        </p>
      ) : (
        <div style={S.list}>
          {items.map((item, i) => {
            const sms = isSmsItem(item)
            return (
              <div key={`${item.capability_key}-${i}`} style={S.item}>
                <div style={S.itemHead}>
                  <Wrench
                    size={18}
                    weight="regular"
                    color="var(--mate-primary, #e14d1a)"
                    style={{ flexShrink: 0, marginTop: 1 }}
                  />
                  <div>
                    <div style={S.itemLabel}>{item.label}</div>
                    <div style={S.itemReason}>{item.reason}</div>
                  </div>
                </div>
                {sms && (
                  <div style={S.note}>
                    <Info
                      size={15}
                      weight="regular"
                      color="#888888"
                      style={{ flexShrink: 0, marginTop: 1 }}
                    />
                    <span>{SMS_NOTE}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
