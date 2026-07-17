import { NextResponse } from "next/server"
import { streamText, tool } from "ai"
import { openai } from "@ai-sdk/openai"
import { createServiceClient } from "@/lib/supabase/service"
import { mateSystemPrompt } from "@/lib/mate/system-prompt"
import { toolSchemas, applyToolResult, type Collected } from "@/lib/mate/tools"
import { capabilitySummary, type Capability } from "@/lib/mate/capability"

type StoredMessage = { role: "user" | "assistant"; content: string; ts?: string }

export async function POST(req: Request) {
  // Parse + validate the body. Bad JSON or missing fields => 400, never throw.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { sessionId, message } = (body ?? {}) as {
    sessionId?: unknown
    message?: unknown
  }

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return NextResponse.json({ error: "Missing or invalid sessionId" }, { status: 400 })
  }
  if (typeof message !== "string" || message.trim() === "") {
    return NextResponse.json({ error: "Missing or invalid message" }, { status: 400 })
  }

  // Service-role client, created INSIDE the handler, never at module scope.
  // Bypasses RLS so this trusted server route can load/persist onboarding_sessions.
  const supabase = createServiceClient()

  const { data: session, error: loadError } = await supabase
    .from("onboarding_sessions")
    .select("id, mate_name, collected, messages, website_url, brand, contact_id, reseller_key")
    .eq("id", sessionId)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 })
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // Working copy of the collected blob. Tool executes mutate this via the pure
  // reducer; it is persisted after the stream finishes.
  let collected: Collected =
    session.collected && typeof session.collected === "object"
      ? { ...(session.collected as Collected) }
      : {}

  // Prior conversation, filtered to the two roles streamText accepts.
  const priorMessages: StoredMessage[] = Array.isArray(session.messages)
    ? (session.messages as StoredMessage[]).filter(
        (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
      )
    : []

  const modelMessages = [
    ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: message },
  ]

  const company =
    collected.company && typeof collected.company === "object"
      ? (collected.company as { name?: string })
      : {}

  // Load the client's capability manifest so Mate accurately knows what it CAN do.
  // During onboarding this is often empty; that is fine, the summary becomes "na"
  // and Mate still declines and logs genuinely new asks via requestBuild.
  let capabilities: Capability[] = []
  if (session.contact_id) {
    const { data: caps, error: capsError } = await supabase
      .from("client_capabilities")
      .select("capability_key, label, status")
      .eq("contact_id", session.contact_id)
    if (capsError) {
      console.error("mate route: failed to load client_capabilities", capsError.message)
    } else if (Array.isArray(caps)) {
      capabilities = caps as Capability[]
    }
  }
  const capabilitiesText = capabilitySummary(capabilities)

  // Build AI SDK tools from the shared schemas. Each execute applies the pure
  // reducer to the working copy and returns a short ack the model can narrate.
  const tools = {
    saveField: tool({
      description: toolSchemas.saveField.description,
      parameters: toolSchemas.saveField.parameters,
      execute: async ({ key, value }) => {
        collected = applyToolResult(collected, { tool: "saveField", args: { key, value } })
        return { saved: key }
      },
    }),
    confirmServices: tool({
      description: toolSchemas.confirmServices.description,
      parameters: toolSchemas.confirmServices.parameters,
      execute: async ({ services }) => {
        collected = applyToolResult(collected, { tool: "confirmServices", args: { services } })
        return { saved: "services", count: services.length }
      },
    }),
    setBrandVoice: tool({
      description: toolSchemas.setBrandVoice.description,
      parameters: toolSchemas.setBrandVoice.parameters,
      execute: async ({ voice }) => {
        collected = applyToolResult(collected, { tool: "setBrandVoice", args: { voice } })
        return { saved: "brand_voice" }
      },
    }),
    // Side-effect tool: logs an out-of-scope ask into build_requests (the upsell
    // queue). It does NOT touch collected. Never throws out of execute — an insert
    // failure is logged server-side and we still return a soft ack so the chat
    // keeps flowing and Mate can finish its polite decline.
    requestBuild: tool({
      description: toolSchemas.requestBuild.description,
      parameters: toolSchemas.requestBuild.parameters,
      execute: async ({ request_text, mate_summary }) => {
        try {
          const { error: insertError } = await supabase.from("build_requests").insert({
            contact_id: session.contact_id ?? null,
            session_id: session.id,
            reseller_key: session.reseller_key ?? null,
            request_text,
            mate_summary,
            status: "new",
          })
          if (insertError) {
            console.error("mate route: failed to log build_request", insertError.message)
            return { logged: false }
          }
          return { logged: true }
        } catch (err) {
          console.error("mate route: build_request insert threw", err)
          return { logged: false }
        }
      },
    }),
  }

  // openai(...) is instantiated inside the handler so the build never needs
  // OPENAI_API_KEY. Cost-first model per the model-agnostic rule.
  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: mateSystemPrompt(session.mate_name ?? "Mate", company, capabilitiesText),
    messages: modelMessages,
    tools,
    maxSteps: 5,
    onFinish: async ({ text }) => {
      // Persist after the stream completes: the accumulated collected blob plus
      // the appended user + assistant turns. Failures are logged, not thrown,
      // so a persistence hiccup does not corrupt the already-streamed reply.
      try {
        const now = new Date().toISOString()
        const nextMessages: StoredMessage[] = [
          ...priorMessages,
          { role: "user", content: message, ts: now },
          { role: "assistant", content: text, ts: now },
        ]

        const { error: saveError } = await supabase
          .from("onboarding_sessions")
          .update({
            collected,
            messages: nextMessages,
            updated_at: now,
          })
          .eq("id", sessionId)

        if (saveError) {
          console.error("mate route: failed to persist session", saveError.message)
        }
      } catch (err) {
        console.error("mate route: persistence threw", err)
      }
    },
  })

  return result.toDataStreamResponse()
}
