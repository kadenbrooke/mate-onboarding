"use client"

import { useEffect, useRef, useState } from "react"
import { PaperPlaneRight, PencilSimple, Check, X } from "@phosphor-icons/react"
import type { Brand, CompanyData } from "@/lib/research/website"
import ColorCard from "./cards/ColorCard"
import RegistrationCard from "./cards/RegistrationCard"
import ChannelsCard from "./cards/ChannelsCard"

// Mirror of the server-side cap in /api/session PATCH. Kept in sync so the UI
// prevents an over-long name before the PATCH round-trips and 400s.
const MATE_NAME_MAX = 60

type CardKind = "color" | "registration" | "channels"
type Role = "mate" | "owner"
interface ChatMessage {
  role: Role
  text: string
  /** When set, render the interactive card INSTEAD of a text bubble. */
  card?: CardKind
  /** Card already submitted (render collapsed confirmation, not the live card). */
  cardDone?: boolean
  /** The "money left on the table" moment: rendered as a big, brand-glowing
   *  bubble from the agent. Deterministic math, never model arithmetic.
   *  Client-injected on channels-card submit; like the cards, it does not
   *  re-render from the persisted transcript after a reload. */
  lossData?: { annualLoss: number; leadsPerWeek: number; avgJobValue: number }
}

// Maps tool names from the AI SDK data stream to the card kind they trigger.
// Using a plain Record avoids any type fights with the Set<literal> approach.
const TOOL_TO_CARD: Record<string, CardKind> = {
  showColorCard: "color",
  showRegistrationCard: "registration",
  showChannelsCard: "channels",
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
  // Fired after a Mate turn fully streams in and the server has persisted the
  // updated `collected`. The page re-fetches the session on this signal to see
  // which required fields Mate has captured and, once complete, offers the
  // review advance. Optional so the chat still works standalone.
  onTurnComplete?: () => void
  // Fired when the owner renames their Mate, so the page can keep its own
  // mate_name state in sync (the reveal's first-words intro reads it).
  onNameChange?: (name: string) => void
}

interface ParsedStream {
  text: string
  error: string | null
  toolCalls: { toolName: string }[]
  rest: string
}

/**
 * Parse a chunk of the AI SDK v4 data-stream protocol. Each line is a typed
 * part: `0:"..."` is a text delta (JSON-encoded string), `3:"..."` is an
 * error, and `9:{...}` carries a tool call (toolCallId, toolName, args).
 * Returns the unconsumed tail so a partial trailing line can be carried to the
 * next read.
 */
function parseDataStream(buffer: string): ParsedStream {
  let text = ""
  let error: string | null = null
  const toolCalls: { toolName: string }[] = []

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
      } else if (code === "9") {
        const value = JSON.parse(payload) as { toolName?: unknown }
        if (typeof value?.toolName === "string") toolCalls.push({ toolName: value.toolName })
      }
    } catch {
      // Malformed part — skip it rather than aborting the whole stream.
    }
  }

  return { text, error, toolCalls, rest }
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
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
  } as React.CSSProperties,
  headerName: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--mate-accent, #ede6e6)",
    letterSpacing: "-0.01em",
  } as React.CSSProperties,
  renameButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    color: "#888888",
    cursor: "pointer",
    padding: 2,
    lineHeight: 0,
  } as React.CSSProperties,
  renameInput: {
    background: "#1c1c1c",
    border: "1px solid var(--mate-primary, #e14d1a)",
    borderRadius: 8,
    padding: "6px 10px",
    color: "var(--mate-accent, #ede6e6)",
    fontSize: 14,
    outline: "none",
    minWidth: 0,
    flex: 1,
    maxWidth: 260,
  } as React.CSSProperties,
  renameIconButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 4,
    lineHeight: 0,
  } as React.CSSProperties,
}

function greeting(mateName: string, businessName?: string, hasResearch?: boolean): string {
  const who = businessName?.trim() ? ` for ${businessName.trim()}` : ""
  if (hasResearch) {
    return `Hi, I'm ${mateName}, your new assistant${who}. You can rename me with the pencil up top. I already scanned your website and pulled the basics, so this will be quick. Ready to check what I found?`
  }
  return `Hi, I'm ${mateName}, your new assistant${who}. You can rename me with the pencil up top. I couldn't pull much from your website, so tell me a little about what your business does and we'll go from there.`
}

/**
 * The "money left on the table" moment. Rendered as a message FROM the agent,
 * styled to land as a headline: the annual number huge in the brand color,
 * loss framing above, the "but we can help" turn below. Numbers come from the
 * deterministic loss-math lib via the channels card, never the model.
 */
function LossBubble({
  data,
}: {
  data: { annualLoss: number; leadsPerWeek: number; avgJobValue: number }
}) {
  return (
    <div
      style={{
        alignSelf: "flex-start",
        maxWidth: "92%",
        background: "#1c1c1c",
        border: "1px solid color-mix(in srgb, var(--mate-primary, #e14d1a) 55%, #333333)",
        boxShadow: "0 0 24px color-mix(in srgb, var(--mate-primary, #e14d1a) 18%, transparent)",
        borderRadius: "14px 14px 14px 4px",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "#9a9a9a",
        }}
      >
        MONEY LEFT ON THE TABLE
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 34,
          fontWeight: 800,
          lineHeight: 1.1,
          color: "var(--mate-primary, #e14d1a)",
        }}
      >
        ${data.annualLoss.toLocaleString("en-US")}
        <span style={{ fontSize: 16, fontWeight: 700, color: "#9a9a9a" }}> / year</span>
      </span>
      <p
        style={{
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--mate-accent, #ede6e6)",
          margin: "4px 0 0",
        }}
      >
        That is what walks away if even 1 in 10 of your {data.leadsPerWeek} weekly
        leads hits voicemail and moves on, at $
        {data.avgJobValue.toLocaleString("en-US")} a job.
      </p>
      <p
        style={{
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--mate-accent, #ede6e6)",
          fontWeight: 600,
          margin: 0,
        }}
      >
        The good news? Recovering it is exactly what I am here for. I answer in
        under 60 seconds, every time.
      </p>
    </div>
  )
}

export default function MateChat({
  sessionId,
  brand,
  company,
  mateName,
  initialMessages,
  onTurnComplete,
  onNameChange,
}: MateChatProps) {
  const businessName = company?.name

  // The live display name. Seeded from the prop, then updated in place when the
  // owner renames (so the header, greeting reference, and "typing" line all
  // reflect the new name without a reload).
  const [name, setName] = useState<string>(mateName?.trim() || "Mate")
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const prior = (initialMessages ?? [])
      .filter((m) => m && typeof m.content === "string")
      .map<ChatMessage>((m) => ({
        role: m.role === "user" ? "owner" : "mate",
        text: m.content,
      }))
    if (prior.length > 0) return prior
    // Fresh session: open with Mate's greeting so the owner sees a start point.
    // Reload note: persisted messages are text-only; cards do not re-render after
    // a reload. If a card step was not completed, the owner can ask and Mate will
    // re-trigger the card via the tool call.
    const hasResearch = !!(company?.services?.length || company?.phone)
    return [{ role: "mate", text: greeting(name, businessName, hasResearch) }]
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

  // Focus + select the rename input when the owner opens it, so they can type
  // straight over the current name.
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renaming])

  function openRename() {
    setNameDraft(name)
    setRenameError(null)
    setRenaming(true)
  }

  function cancelRename() {
    setRenaming(false)
    setRenameError(null)
    setNameDraft(name)
  }

  async function saveName() {
    const next = nameDraft.trim()
    if (next === "") {
      setRenameError("Name can't be empty.")
      return
    }
    if (next.length > MATE_NAME_MAX) {
      setRenameError(`Keep it to ${MATE_NAME_MAX} characters or fewer.`)
      return
    }
    // No-op if unchanged: just close the editor.
    if (next === name) {
      setRenaming(false)
      setRenameError(null)
      return
    }

    setSavingName(true)
    setRenameError(null)
    try {
      const res = await fetch("/api/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, mate_name: next }),
      })
      if (!res.ok) {
        throw new Error("Couldn't save the name. Try again.")
      }
      // Persisted: reflect the new name live everywhere it's rendered.
      setName(next)
      onNameChange?.(next)
      setRenaming(false)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed.")
    } finally {
      setSavingName(false)
    }
  }

  function onRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      saveName()
    } else if (e.key === "Escape") {
      e.preventDefault()
      cancelRename()
    }
  }

  // Core fetch-and-stream implementation. Used by both the owner typing a message
  // (via send()) and by card submissions auto-continuing the flow (handleCardDone).
  // opts.restoreDraft: if true and the send fails, re-populate the input with the
  // original text. Only typed sends pass this; card continuations do not (their
  // text is synthetic and there is no draft slot to restore).
  async function sendProgrammatic(text: string, opts?: { restoreDraft?: boolean }) {
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
      // Accumulate card kinds seen across all stream chunks so we can append
      // card messages after the stream finishes (deduped).
      const seenCards: CardKind[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        carry += decoder.decode(value, { stream: true })
        const { text: delta, error: partError, toolCalls, rest } = parseDataStream(carry)
        carry = rest
        if (partError) streamError = partError
        // Collect card kinds from any tool calls in this chunk.
        for (const tc of toolCalls) {
          const kind = TOOL_TO_CARD[tc.toolName]
          if (kind && !seenCards.includes(kind)) seenCards.push(kind)
        }
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
        const { text: delta, error: partError, toolCalls: trailingCalls } = parseDataStream(carry + "\n")
        if (partError) streamError = partError
        for (const tc of trailingCalls) {
          const kind = TOOL_TO_CARD[tc.toolName]
          if (kind && !seenCards.includes(kind)) seenCards.push(kind)
        }
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

      // Append one card message per seen card kind (deduped above), THEN signal
      // the page. Cards render below Mate's text bubble in the chat log.
      if (seenCards.length > 0) {
        setMessages((prev) => [
          ...prev,
          ...seenCards.map<ChatMessage>((kind) => ({ role: "mate", text: "", card: kind })),
        ])
      }

      if (streamError) setError(streamError)

      // The turn streamed cleanly and (per the AI SDK) the server awaited its
      // onFinish persistence before closing the stream, so the updated
      // `collected` is now saved. Signal the page to re-check completion.
      // Guarded on no stream error so a soft failure doesn't advance the flow.
      if (!streamError) onTurnComplete?.()
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
      // Restore the typed draft so the owner can retry without retyping.
      // Card continuations never set this flag — their text is synthetic.
      if (opts?.restoreDraft) setDraft(text)
    } finally {
      setBusy(false)
    }
  }

  function send() {
    const text = draft.trim()
    if (!text || busy) return
    setDraft("")
    sendProgrammatic(text, { restoreDraft: true })
  }

  // Card submit -> collapse the card + auto-send a short confirmation so Mate
  // continues the flow without the owner typing anything.
  // The confirm button on each card is disabled when streaming=true (primary
  // guard). This belt-and-braces return handles the race where busy flips true
  // just after the button render but before the click handler fires, preventing
  // index drift and lost turns server-side.
  function handleCardDone(kind: CardKind, continuation: string) {
    if (busy) return
    setMessages((prev) =>
      prev.map((m) => (m.card === kind && !m.cardDone ? { ...m, cardDone: true } : m))
    )
    sendProgrammatic(continuation)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        {renaming ? (
          <>
            <input
              ref={renameInputRef}
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={onRenameKeyDown}
              maxLength={MATE_NAME_MAX}
              style={S.renameInput}
              disabled={savingName}
              aria-label="Rename your Mate"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={savingName}
              style={{
                ...S.renameIconButton,
                color: "var(--mate-primary, #e14d1a)",
                ...(savingName ? S.buttonDisabled : {}),
              }}
              aria-label="Save name"
              title="Save"
            >
              <Check size={18} weight="bold" />
            </button>
            <button
              type="button"
              onClick={cancelRename}
              disabled={savingName}
              style={{ ...S.renameIconButton, color: "#888888" }}
              aria-label="Cancel rename"
              title="Cancel"
            >
              <X size={18} weight="bold" />
            </button>
          </>
        ) : (
          <>
            <span style={S.headerName}>{name}</span>
            <button
              type="button"
              onClick={openRename}
              style={S.renameButton}
              aria-label="Rename your Mate"
              title="Rename"
            >
              <PencilSimple size={16} />
            </button>
          </>
        )}
      </div>

      {renameError && <p style={S.error}>{renameError}</p>}

      <div ref={logRef} style={S.log}>
        {messages.map((m, i) => {
          if (m.card === "color")
            return (
              <ColorCard
                key={i}
                sessionId={sessionId}
                brand={brand}
                done={!!m.cardDone}
                streaming={busy}
                onDone={() => handleCardDone("color", "Colors are set.")}
              />
            )
          if (m.card === "registration")
            return (
              <RegistrationCard
                key={i}
                sessionId={sessionId}
                done={!!m.cardDone}
                streaming={busy}
                onDone={() => handleCardDone("registration", "Registration details are in.")}
              />
            )
          if (m.card === "channels")
            return (
              <ChannelsCard
                key={i}
                sessionId={sessionId}
                done={!!m.cardDone}
                streaming={busy}
                onDone={(lossData) => {
                  // The money moment gets its own big bubble from the agent
                  // BEFORE the flow continues, so it lands as a headline, not
                  // a side note. Deterministic math from the card; the prompt
                  // tells the model not to re-recite the numbers.
                  if (lossData) {
                    setMessages((prev) => [
                      ...prev,
                      { role: "mate", text: "", lossData },
                    ])
                  }
                  handleCardDone("channels", "Lead channels are picked.")
                }}
              />
            )
          if (m.lossData)
            return <LossBubble key={i} data={m.lossData} />
          return (
            <div key={i} style={m.role === "owner" ? S.bubbleOwner : S.bubbleMate}>
              {m.text}
            </div>
          )
        })}
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
