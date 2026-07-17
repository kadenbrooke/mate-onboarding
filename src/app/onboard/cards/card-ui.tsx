"use client"

import type React from "react"

/**
 * Shared visual primitives + styles for the onboarding action cards.
 *
 * The cards render inline in the onboarding flow (a card rail alongside Mate's
 * chat) for the structured steps that need real inputs/buttons rather than
 * free-text. Everything themes off the client's brand via the --mate-* CSS
 * vars set on :root by the website step / page, with dark defaults so an
 * un-themed session still looks right. White-label: no Auto Mate branding,
 * no emoji, no em dashes.
 */

export const cardStyles = {
  card: {
    background: "#1a1a1a",
    border: "1px solid #333333",
    borderRadius: 16,
    padding: "20px 18px",
    width: "100%",
    maxWidth: 560,
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  } as React.CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } as React.CSSProperties,
  headIcon: {
    color: "var(--mate-primary, #e14d1a)",
    flexShrink: 0,
  } as React.CSSProperties,
  title: {
    fontFamily: "var(--font-display)",
    fontSize: 17,
    fontWeight: 700,
    color: "var(--mate-accent, #ede6e6)",
    margin: 0,
  } as React.CSSProperties,
  why: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#9a9a9a",
    margin: 0,
  } as React.CSSProperties,
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--mate-accent, #ede6e6)",
    display: "block",
    marginBottom: 6,
  } as React.CSSProperties,
  hint: {
    fontSize: 12,
    color: "#8a8a8a",
    marginTop: -2,
    marginBottom: 6,
    lineHeight: 1.45,
  } as React.CSSProperties,
  input: {
    width: "100%",
    background: "#0f0f0f",
    border: "1px solid #333333",
    borderRadius: 10,
    padding: "11px 13px",
    color: "var(--mate-accent, #ede6e6)",
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
  } as React.CSSProperties,
  inputError: {
    borderColor: "#f5a97f",
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    background: "#0f0f0f",
    border: "1px solid #333333",
    borderRadius: 10,
    padding: "11px 13px",
    color: "var(--mate-accent, #ede6e6)",
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
    resize: "vertical" as const,
    minHeight: 64,
  } as React.CSSProperties,
  chipRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
  } as React.CSSProperties,
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    padding: "7px 12px",
    borderRadius: 999,
    border: "1px solid #333333",
    background: "#0f0f0f",
    color: "var(--mate-accent, #ede6e6)",
    cursor: "pointer",
    userSelect: "none" as const,
  } as React.CSSProperties,
  chipSelected: {
    borderColor: "var(--mate-primary, #e14d1a)",
    background: "color-mix(in srgb, var(--mate-primary, #e14d1a) 12%, transparent)",
  } as React.CSSProperties,
  removeBtn: {
    background: "transparent",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    padding: 0,
    lineHeight: 0,
  } as React.CSSProperties,
  addRow: {
    display: "flex",
    gap: 8,
    alignItems: "stretch",
  } as React.CSSProperties,
  confirmBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "var(--mate-primary, #e14d1a)",
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "var(--font-display)",
  } as React.CSSProperties,
  confirmBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  } as React.CSSProperties,
  ghostBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    background: "#0f0f0f",
    color: "var(--mate-accent, #ede6e6)",
    border: "1px solid #333333",
    borderRadius: 10,
    padding: "11px 14px",
    fontSize: 14,
    cursor: "pointer",
    flexShrink: 0,
  } as React.CSSProperties,
  error: {
    fontSize: 12.5,
    color: "#f5a97f",
    margin: 0,
  } as React.CSSProperties,
  saved: {
    fontSize: 12.5,
    color: "#7fd39b",
    margin: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,
}

/** Card header: brand-tinted Phosphor icon + title. */
export function CardHead({
  icon,
  title,
}: {
  icon: React.ReactNode
  title: string
}) {
  return (
    <div style={cardStyles.head}>
      <span style={cardStyles.headIcon}>{icon}</span>
      <h2 style={cardStyles.title}>{title}</h2>
    </div>
  )
}

/**
 * Persist a whitelisted slice of `collected` for a session via the PATCH
 * endpoint. Returns nothing on success and throws on failure so callers can
 * surface an inline error and keep the owner on the card.
 */
export async function saveCollected(
  sessionId: string,
  collected: Record<string, unknown>
): Promise<void> {
  const res = await fetch("/api/session", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: sessionId, collected }),
  })
  if (!res.ok) {
    let msg = "Could not save that. Please try again."
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) msg = body.error
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new Error(msg)
  }
}
