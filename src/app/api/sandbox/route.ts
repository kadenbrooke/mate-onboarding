import { NextResponse } from "next/server"
import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { createServiceClient } from "@/lib/supabase/service"
import { sandboxSystemPrompt } from "@/lib/mate/sandbox-agent"

// POST /api/sandbox — the personalized in-browser reveal.
//
// The owner texts a fake lead on-screen and watches their own First Responder
// reply in their brand voice, using their real business name + services. This is
// a DEMO: it loads `collected` from the session to seed the agent's persona but
// it does NOT persist anything (no DB writes, ephemeral). The conversation
// history is maintained client-side and posted back on each turn.
//
// Cost-first gpt-4o-mini per .claude/rules/model-agnostic.md: 1-2 sentence SMS
// qualify replies are the cheapest-model-that-clears-the-bar case.

type Turn = { role: "user" | "assistant"; content: string }

// Cap the history we send to the model so a long sandbox thread's prompt does
// not grow unbounded. The sandbox is ephemeral, so nothing is lost by bounding.
const MAX_HISTORY_TURNS = 12

/** Coerce an untrusted history payload into clean user/assistant turns. */
function sanitizeHistory(input: unknown): Turn[] {
  if (!Array.isArray(input)) return []
  const out: Turn[] = []
  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim() !== "") {
      out.push({ role, content })
    }
  }
  // Only the most recent turns are sent to the model.
  return out.slice(-MAX_HISTORY_TURNS)
}

export async function POST(req: Request) {
  // Parse + validate the body. Bad JSON or missing fields => 400, never throw.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { sessionId, message, history } = (body ?? {}) as {
    sessionId?: unknown
    message?: unknown
    history?: unknown
  }

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return NextResponse.json({ error: "Missing or invalid sessionId" }, { status: 400 })
  }
  if (typeof message !== "string" || message.trim() === "") {
    return NextResponse.json({ error: "Missing or invalid message" }, { status: 400 })
  }

  // Service-role client, created INSIDE the handler, never at module scope.
  // Used ONLY to load the session's collected persona for the sandbox seed. The
  // sandbox does not write to the DB.
  const supabase = createServiceClient()

  const { data: session, error: loadError } = await supabase
    .from("onboarding_sessions")
    .select("id, collected, mate_name")
    .eq("id", sessionId)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 })
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const collected: Record<string, unknown> =
    session.collected && typeof session.collected === "object" && !Array.isArray(session.collected)
      ? (session.collected as Record<string, unknown>)
      : {}

  const system = sandboxSystemPrompt(collected)
  const priorTurns = sanitizeHistory(history)
  const messages: Turn[] = [...priorTurns, { role: "user", content: message }]

  // openai(...) is instantiated inside the handler so the build never needs
  // OPENAI_API_KEY. Cost-first model per the model-agnostic rule. A model
  // failure returns a soft-error JSON — we never throw to the client so the
  // demo chat keeps flowing.
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      system,
      messages,
      maxTokens: 300,
    })

    const reply = text?.trim()
    if (!reply) {
      return NextResponse.json({ reply: "Thanks! I'll have the team follow up shortly." })
    }
    return NextResponse.json({ reply })
  } catch (err) {
    console.error("sandbox route: generateText failed", err)
    return NextResponse.json({
      reply: "Thanks for reaching out! I'll have the team text you right back.",
    })
  }
}
