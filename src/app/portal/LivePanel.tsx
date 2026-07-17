"use client"

import { CheckCircle } from "@phosphor-icons/react"
import type { LiveItem } from "@/lib/portal/capabilities"

// The "Live" zone: capabilities functional right now. Never fabricates entries —
// if the client has nothing live yet, an honest empty state renders instead.

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
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    background: "#1c1c1c",
    border: "1px solid #2a2a2a",
    borderRadius: 10,
  } as React.CSSProperties,
  itemLabel: {
    fontSize: 14,
    color: "var(--mate-accent, #ede6e6)",
    lineHeight: 1.4,
  } as React.CSSProperties,
  itemMeta: {
    fontSize: 12,
    color: "#7dd88f",
    marginTop: 2,
  } as React.CSSProperties,
  empty: {
    fontSize: 13,
    color: "#888888",
    lineHeight: 1.5,
    margin: 0,
  } as React.CSSProperties,
}

export default function LivePanel({ items }: { items: LiveItem[] }) {
  return (
    <div style={S.panel}>
      <div style={S.head}>
        <CheckCircle size={20} weight="fill" color="#7dd88f" />
        <h2 style={S.title}>Live now</h2>
      </div>

      {items.length === 0 ? (
        <p style={S.empty}>
          Nothing is live just yet. As each part of your system switches on, it
          moves here so you always know what is working.
        </p>
      ) : (
        <div style={S.list}>
          {items.map((item) => (
            <div key={item.capability_key} style={S.item}>
              <CheckCircle
                size={18}
                weight="fill"
                color="#7dd88f"
                style={{ flexShrink: 0, marginTop: 1 }}
              />
              <div>
                <div style={S.itemLabel}>{item.label}</div>
                <div style={S.itemMeta}>Working now</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
