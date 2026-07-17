"use client"

import { useEffect, useRef, useState } from "react"
import { PaperPlaneRight } from "@phosphor-icons/react"
import type { Brand, CompanyData } from "@/lib/research/website"

type Role = "mate" | "owner"
interface ChatMessage {
  role: Role
  text: string
}

interface PriorMessage {
  role: "user" | "assistant"
  content: string
}

interface MateChatProps {
  sessionId: string
  brand?: Brand | null
  company?: CompanyData | null
  mateName?: string | null
  // Any prior turns already persisted on the session, so a reload rehydrates
  // the conversation instead of restarting it.
  initialMessages?: PriorMessage[]
}

/**
 * Parse a chunk of the AI SDK v4 data-stream protocol. Each line is a typed
 * part: `0:"..."` is a text delta (JSON-encoded string) and `3:"..."` is an
 * error. We only care about text and error parts for rendering; tool-call and
 * finish parts are ignored (the server persists the results). Returns the
 * unconsumed tail so a partial trailing line can be carried to the next read.
 */
function parseDataStream(
  buffer: string
): { text: string; error: string | null; rest: string } {
  let text = ""
  let error: string | null = null

  const lines = buffer.split("\n")
  // The last element is either "" (clean boundary) or a partial line to keep.
  const rest = lines.pop() ?? ""

  for (const line of lines) {
    if (line === "") continue
    const sep = line.indexOf(":")
    if (sep === -1) continue
    const code = line.slice(0, sep)
    const payload = line.slice(sep + 1)
    try {
      if (code === "0") {
        const value = JSON.parse(payload)
        if (typeof value === "string") text += value
      } else if (code === "3") {
        const value = JSON.parse(payload)
        error = typeof value === "string" ? value : "Something went wrong."
      }
    } catch {
      // Malformed part — skip it rather than aborting the whole stream.
    }
  }

  return { text, error, rest }
}

const S = {
  wrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    width: "100%",
    maxWidth: 560,
    flex: 1,
    minHeight: 0,
  } as React.CSSProperties,
  log: {
    flex: 1,
    minHeight: 240,
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    padding: "4px 2px",
  } as React.CSSProperties,
  bubbleOwner: {
    alignSelf: "flex-end",
    background: "var(--mate-primary, #e14d1a)",
    color: "#ffffff",
    borderRadius: "12px 12px 2px 12px",
    padding: "9px 13px",
    fontSize: 14,
    maxWidth: "82%",
    lineHeight: 1.45,
    whiteSpace: "pre-wrap" as const,
  } as React.CSSProperties,
  bubbleMate: {
    alignSelf: "flex-start",
    background: "#1c1c1c",
    border: "1px solid #333333",
    color: "var(--mate-accent, #ede6e6)",
    borderRadius: "12px 12px 12px 2px",
    padding: "9px 13px",
    fontSize: 14,
    maxWidth: "82%",
    lineHeight: 1.45,
    whiteSpace: "pre-wrap" as const,
  } as React.CSSProperties,
  thinking: {
    alignSelf: "flex-start",
    color: "#888888",
    fontSize: 13,
    fontStyle: "italic" as const,
    padding: "2px 4px",
  } as React.CSSProperties,
  row: {
    display: "flex",
    gap: 8,
    alignItems: "stretch",
  } as React.CSSProperties,
  input: {
    flex: 1,
    background: "#1c1c1c",
    border: "1px solid #333333",
    borderRadius: 10,
    padding: "12px 14px",
    color: "var(--mate-accent, #ede6e6)",
    fontSize: 15,
    outline: "none",
  } as React.CSSProperties,
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--mate-primary, #e14d1a)",
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    cursor: "pointer",
    flexShrink: 0,
  } as React.CSSProperties,
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  } as React.CSSProperties,
  error: {
    fontSize: 13,
    color: "#f5a97f",
  } as React.CSSProperties,
}

function greeting(mateName: string, businessName?: string): string {
  const who = businessName?.trim() ? ` for ${businessName.trim()}` : ""
  return `Hi, I'm ${mateName}${who}. I'll get your new phone and text assistant set up by just chatting with you, no forms. Ready when you are. To start, what does your business do?`
}

export default function MateChat({
  sessionId,
  brand,
  company,
  mateName,
  initialMessages,
}: MateChatProps) {
  const name = mateName?.trim() || "Mate"
  const businessName = company?.name

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const prior = (initialMessages ?? [])
      .filter((m) => m && typeof m.content === "string")
      .map<ChatMessage>((m) => ({
        role: m.role === "user" ? "owner" : "mate",
        text: m.content,
      }))
    if (prior.length > 0) return prior
    // Fresh session: open with Mate's greeting so the owner sees a start point.
    return [{ role: "mate", text: greeting(name, businessName) }]
  })
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Keep the log pinned to the latest message (including while streaming).
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages, busy])

  // Apply the client's brand theme on mount so a rehydrated chat (page load
  // straight into the chat step) still shows their colors, not the default.
  useEffect(() => {
    if (!brand) return
    const root = document.documentElement
    root.style.setProperty("--mate-primary", brand.colors.primary)
    root.style.setProperty("--mate-bg", brand.colors.bg)
    root.style.setProperty("--mate-accent", brand.colors.accent)
  }, [brand])

  async function send() {
    const text = draft.trim()
    if (!text || busy) return

    setDraft("")
    setError(null)
    setBusy(true)
    // Optimistic owner bubble.
    setMessages((prev) => [...prev, { role: "owner", text }])

    try {
      const res = await fetch("/api/mate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      })

      if (!res.ok || !res.body) {
        throw new Error("Mate is unavailable right now.")
      }

      // Add an empty Mate bubble we grow as text streams in.
      let mateIndex = -1
      setMessages((prev) => {
        mateIndex = prev.length
        return [...prev, { role: "mate", text: "" }]
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let carry = ""
      let streamError: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        carry += decoder.decode(value, { stream: true })
        const { text: delta, error: partError, rest } = parseDataStream(carry)
        carry = rest
        if (partError) streamError = partError
        if (delta) {
          setMessages((prev) => {
            const next = [...prev]
            const target = next[mateIndex]
            if (target && target.role === "mate") {
              next[mateIndex] = { ...target, text: target.text + delta }
            }
            return next
          })
        }
      }

      // Flush any trailing buffered part after the stream closes.
      if (carry.trim() !== "") {
        const { text: delta, error: partError } = parseDataStream(carry + "\n")
        if (partError) streamError = partError
        if (delta) {
          setMessages((prev) => {
            const next = [...prev]
            const target = next[mateIndex]
            if (target && target.role === "mate") {
              next[mateIndex] = { ...target, text: target.text + delta }
            }
            return next
          })
        }
      }

      if (streamError) setError(streamError)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mate error.")
      // Roll back the optimistic owner bubble and restore the draft.
      setMessages((prev) => {
        const trimmed = [...prev]
        // Drop a trailing empty Mate bubble if one was added.
        if (trimmed.length && trimmed[trimmed.length - 1].role === "mate" && trimmed[trimmed.length - 1].text === "") {
          trimmed.pop()
        }
        if (trimmed.length && trimmed[trimmed.length - 1].role === "owner") {
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
      <div ref={logRef} style={S.log}>
        {messages.map((m, i) => (
          <div key={i} style={m.role === "owner" ? S.bubbleOwner : S.bubbleMate}>
            {m.text}
          </div>
        ))}
        {busy && <div style={S.thinking}>{name} is typing...</div>}
      </div>

      {error && <p style={S.error}>{error}</p>}

      <div style={S.row}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message ${name}...`}
          style={S.input}
          disabled={busy}
          aria-label="Message"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || draft.trim() === ""}
          style={{
            ...S.button,
            ...(busy || draft.trim() === "" ? S.buttonDisabled : {}),
          }}
          aria-label="Send"
        >
          <PaperPlaneRight size={18} weight="fill" />
        </button>
      </div>
    </div>
  )
}
