"use client"

import { useEffect, useRef, useState } from "react"
import { ChatCircle, PaperPlaneRight, Lightning } from "@phosphor-icons/react"
import { sandboxGreeting } from "@/lib/mate/sandbox-agent"
import type { CollectedShape } from "./cards/ReviewScreen"

/**
 * SandboxReveal — the "meet your First Responder" moment at the end of onboarding.
 *
 * The owner texts a fake lead on-screen and watches THEIR agent reply in THEIR
 * brand voice, using their real business name + services (seeded from the
 * session's collected). Distinct from the Mate concierge chat: this is styled as
 * a realistic SMS thread where the owner plays the customer (right, brand-tinted)
 * and their agent replies (left). It is a DEMO: ephemeral, no persistence, no
 * real phone number. We are honest that the live number activates only after
 * carrier vetting (10DLC) clears.
 *
 * History is maintained client-side and posted to /api/sandbox each turn. The
 * server loads the persona from collected and calls gpt-4o-mini; nothing is
 * written back. White-label: no Auto Mate branding, Phosphor icons, no emoji,
 * no em dashes.
 */

// The role stored in the ephemeral history posted to the API. The agent's turn
// is "assistant"; the owner-playing-customer is "user".
type Turn = { role: "user" | "assistant"; content: string }

interface SandboxRevealProps {
  sessionId: string
  // The session's collected blob. Only company.name / services / brand_voice are
  // read (persona seed); passing the whole shape keeps the caller simple.
  collected: CollectedShape
  /** The agent's current name (from session.mate_name). Used in the first-words
   *  intro so the owner hears "I'm {name}, the new assistant for {business}." */
  mateName?: string | null
}

const S = {
  wrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
    width: "100%",
    maxWidth: 560,
    flex: 1,
    minHeight: 0,
  } as React.CSSProperties,
  intro: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  } as React.CSSProperties,
  introHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,
  heading: {
    fontFamily: "var(--font-display)",
    fontSize: 20,
    fontWeight: 700,
    color: "var(--mate-accent, #ede6e6)",
    margin: 0,
  } as React.CSSProperties,
  sub: {
    fontSize: 13.5,
    color: "#9a9a9a",
    margin: 0,
    lineHeight: 1.5,
  } as React.CSSProperties,
  // The "phone" frame — a rounded device shell that visually separates this SMS
  // thread from the concierge chat above/before it.
  phone: {
    display: "flex",
    flexDirection: "column" as const,
    background: "#0f0f0f",
    border: "1px solid #333333",
    borderRadius: 22,
    overflow: "hidden",
    flex: 1,
    minHeight: 320,
  } as React.CSSProperties,
  phoneBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid #262626",
    background: "#151515",
  } as React.CSSProperties,
  phoneBarIcon: {
    color: "var(--mate-primary, #e14d1a)",
    flexShrink: 0,
  } as React.CSSProperties,
  phoneBarName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--mate-accent, #ede6e6)",
    letterSpacing: "-0.01em",
  } as React.CSSProperties,
  phoneBarMeta: {
    fontSize: 11.5,
    color: "#7a7a7a",
    marginLeft: "auto",
  } as React.CSSProperties,
  log: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    padding: "14px 14px 4px",
  } as React.CSSProperties,
  // The owner is playing the incoming customer: right-aligned, brand-tinted.
  bubbleCustomer: {
    alignSelf: "flex-end",
    background: "var(--mate-primary, #e14d1a)",
    color: "#ffffff",
    borderRadius: "16px 16px 4px 16px",
    padding: "9px 13px",
    fontSize: 14,
    maxWidth: "80%",
    lineHeight: 1.45,
    whiteSpace: "pre-wrap" as const,
  } as React.CSSProperties,
  // The client's own First Responder: left-aligned, neutral bubble.
  bubbleAgent: {
    alignSelf: "flex-start",
    background: "#1e1e1e",
    border: "1px solid #333333",
    color: "var(--mate-accent, #ede6e6)",
    borderRadius: "16px 16px 16px 4px",
    padding: "9px 13px",
    fontSize: 14,
    maxWidth: "80%",
    lineHeight: 1.45,
    whiteSpace: "pre-wrap" as const,
  } as React.CSSProperties,
  typing: {
    alignSelf: "flex-start",
    color: "#888888",
    fontSize: 13,
    fontStyle: "italic" as const,
    padding: "2px 4px",
  } as React.CSSProperties,
  composer: {
    display: "flex",
    gap: 8,
    alignItems: "stretch",
    padding: "10px 12px",
    borderTop: "1px solid #262626",
    background: "#151515",
  } as React.CSSProperties,
  input: {
    flex: 1,
    background: "#0f0f0f",
    border: "1px solid #333333",
    borderRadius: 999,
    padding: "11px 15px",
    color: "var(--mate-accent, #ede6e6)",
    fontSize: 15,
    outline: "none",
  } as React.CSSProperties,
  sendBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--mate-primary, #e14d1a)",
    color: "#ffffff",
    border: "none",
    borderRadius: 999,
    width: 44,
    height: 44,
    cursor: "pointer",
    flexShrink: 0,
  } as React.CSSProperties,
  sendBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  } as React.CSSProperties,
  error: {
    fontSize: 13,
    color: "#f5a97f",
    margin: 0,
  } as React.CSSProperties,
  demoNote: {
    fontSize: 12,
    color: "#8a8a8a",
    lineHeight: 1.5,
    margin: 0,
    textAlign: "center" as const,
  } as React.CSSProperties,
}

function businessName(collected: CollectedShape): string {
  const name = collected?.company?.name
  return typeof name === "string" && name.trim() !== "" ? name.trim() : "your agent"
}

export default function SandboxReveal({ sessionId, collected, mateName }: SandboxRevealProps) {
  const agentLabel = businessName(collected)

  // Ephemeral conversation. Seeded with the agent's missed-call text-back so the
  // owner has an opening bubble to reply to, exactly like a real missed-call
  // text-back would arrive.
  const [turns, setTurns] = useState<Turn[]>(() => [
    { role: "assistant", content: sandboxGreeting(collected as Record<string, unknown>, mateName) },
  ])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Keep the thread pinned to the newest message.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [turns, busy])

  async function send() {
    const text = draft.trim()
    if (!text || busy) return

    setDraft("")
    setError(null)
    setBusy(true)

    // The history the server should see is everything BEFORE this new turn.
    const history = turns
    // Optimistically show the owner's (customer's) message.
    setTurns((prev) => [...prev, { role: "user", content: text }])

    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text, history }),
      })

      if (!res.ok) {
        throw new Error("Your agent is unavailable right now.")
      }

      const data = (await res.json()) as { reply?: string; error?: string }
      const reply = typeof data.reply === "string" ? data.reply.trim() : ""
      if (!reply) {
        throw new Error("Your agent did not reply. Try again.")
      }

      setTurns((prev) => [...prev, { role: "assistant", content: reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      // Roll back the optimistic customer bubble and restore the draft.
      setTurns((prev) => {
        const trimmed = [...prev]
        if (trimmed.length && trimmed[trimmed.length - 1].role === "user") {
          trimmed.pop()
        }
        return trimmed
      })
      setDraft(text)
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.intro}>
        <div style={S.introHead}>
          <Lightning size={20} weight="fill" style={{ color: "var(--mate-primary, #e14d1a)" }} />
          <h2 style={S.heading}>Meet your First Responder</h2>
        </div>
        <p style={S.sub}>
          This is a preview of your agent, in your voice. Text it like a customer would and watch it reply.
        </p>
      </div>

      <div style={S.phone}>
        <div style={S.phoneBar}>
          <ChatCircle size={18} weight="fill" style={S.phoneBarIcon} />
          <span style={S.phoneBarName}>{agentLabel}</span>
          <span style={S.phoneBarMeta}>Text message</span>
        </div>

        <div ref={logRef} style={S.log}>
          {turns.map((t, i) => (
            <div key={i} style={t.role === "user" ? S.bubbleCustomer : S.bubbleAgent}>
              {t.content}
            </div>
          ))}
          {busy && <div style={S.typing}>Typing...</div>}
        </div>

        <div style={S.composer}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Text like a customer..."
            style={S.input}
            disabled={busy}
            aria-label="Text your agent like a customer"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || draft.trim() === ""}
            style={{
              ...S.sendBtn,
              ...(busy || draft.trim() === "" ? S.sendBtnDisabled : {}),
            }}
            aria-label="Send"
          >
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        </div>
      </div>

      {error && <p style={S.error}>{error}</p>}

      <p style={S.demoNote}>
        This is a preview. Your live number activates once carrier vetting clears, usually 1 to 3 weeks.
      </p>
    </div>
  )
}
