import { NextResponse } from "next/server"
import { streamText, tool } from "ai"
import { z } from "zod"
import { openai } from "@ai-sdk/openai"
import { createServiceClient } from "@/lib/supabase/service"
import { mateSystemPrompt, type ResearchedCompany } from "@/lib/mate/system-prompt"
import { matePortalPrompt } from "@/lib/mate/portal-prompt"
import { toolSchemas, applyToolResult, type Collected } from "@/lib/mate/tools"
import { capabilitySummary, type Capability } from "@/lib/mate/capability"
import { isMaskedValue, scrubEinPatterns } from "@/lib/mate/mask"
import { buildPortalToolFns } from "@/lib/mate/portal-tools"

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

  let resolvedSessionId = sessionId
  const secret = process.env.MATE_SESSION_SECRET
  const cookieToken = req.headers.get("cookie")?.match(/(?:^|;\s*)mate_session=([^;]+)/)?.[1]
  if (secret && cookieToken) {
    const { verifySession } = await import("@/lib/session-cookie")
    // decodeURIComponent throws on malformed percent sequences; a garbage
    // cookie must fall back to the body sessionId, never 500.
    let decoded: string | null = null
    try {
      decoded = decodeURIComponent(cookieToken)
    } catch {
      decoded = null
    }
    const verified = decoded ? verifySession(decoded, secret) : null
    if (verified) resolvedSessionId = verified
  }

  // Service-role client, created INSIDE the handler, never at module scope.
  // Bypasses RLS so this trusted server route can load/persist onboarding_sessions.
  const supabase = createServiceClient()

  const { data: session, error: loadError } = await supabase
    .from("onboarding_sessions")
    .select("id, mate_name, collected, messages, website_url, brand, contact_id, reseller_key, step, status")
    .eq("id", resolvedSessionId)
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

  // Pass the full researched company profile through to the prompt so Mate can
  // confirm what it already found (name, services, hours, area, phone, email,
  // address, channels) instead of asking blind. Set server-side by the website
  // research step; never client-writable.
  const company: ResearchedCompany =
    collected.company && typeof collected.company === "object"
      ? (collected.company as ResearchedCompany)
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
        if (key === "ein" && isMaskedValue(value)) {
          return { saved: false, reason: "masked value ignored" }
        }
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
    // UI card triggers: no server mutation; the ack tells the model the card is
    // on screen so it stops talking and waits for the client's confirmation
    // message (sent automatically by the card on submit).
    showColorCard: tool({
      description: toolSchemas.showColorCard.description,
      parameters: toolSchemas.showColorCard.parameters,
      execute: async () => ({ shown: "color" }),
    }),
    showRegistrationCard: tool({
      description: toolSchemas.showRegistrationCard.description,
      parameters: toolSchemas.showRegistrationCard.parameters,
      execute: async () => ({ shown: "registration" }),
    }),
    showChannelsCard: tool({
      description: toolSchemas.showChannelsCard.description,
      parameters: toolSchemas.showChannelsCard.parameters,
      execute: async () => ({ shown: "channels" }),
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

  // Portal mode: derived from the SESSION ROW, never from client input.
  // step/status folded into the initial select above (one query, not two).
  const portalMode =
    (session as { step?: string }).step === "ready" ||
    (session as { status?: string }).status === "complete" ||
    Boolean(session.contact_id)

  // Load build_requests for the portal roster (portal mode + contact bound only).
  let buildRequests: { request_text: string; mate_summary: string; status: string }[] = []
  if (portalMode && session.contact_id) {
    const { data: reqs } = await supabase
      .from("build_requests")
      .select("request_text, mate_summary, status")
      .eq("contact_id", session.contact_id)
    if (Array.isArray(reqs)) buildRequests = reqs
  }

  // Portal tool factory: every query is hard-scoped to this session's contact.
  // capabilities is cast: Capability.label is optional; Cap.label is required.
  // The factory and agentRoster handle missing labels gracefully via || fallback.
  const portalToolFns = buildPortalToolFns({
    supabase,
    contactId: session.contact_id ?? null,
    collected,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    capabilities: capabilities as any,
    requests: buildRequests,
  })

  const portalTools = {
    // Reuse the existing side-effect requestBuild tool.
    requestBuild: tools.requestBuild,
    getAgentStatus: tool({
      description: "Live/demo/coming-soon status of the client's five agents plus open build requests.",
      parameters: z.object({}),
      execute: async () => portalToolFns.getAgentStatus(),
    }),
    getLeadStats: tool({
      description: "Real lead interaction counts for this business. Honest 'no data yet' when empty.",
      parameters: z.object({}),
      execute: async () => portalToolFns.getLeadStats(),
    }),
    getRecentLeads: tool({
      description: "The five most recent lead interactions for this business.",
      parameters: z.object({}),
      execute: async () => portalToolFns.getRecentLeads(),
    }),
    getBusinessProfile: tool({
      description: "Everything collected at setup: services, brand voice, phones, channels, website.",
      parameters: z.object({}),
      execute: async () => portalToolFns.getBusinessProfile(),
    }),
  }

  const businessName =
    (company.name && String(company.name)) || session.mate_name || "your business"

  // openai(...) is instantiated inside the handler so the build never needs
  // OPENAI_API_KEY. Cost-first model per the model-agnostic rule.
  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: portalMode
      ? matePortalPrompt(session.mate_name ?? "Mate", businessName, capabilitiesText)
      : mateSystemPrompt(session.mate_name ?? "Mate", company, capabilitiesText),
    messages: modelMessages,
    tools: portalMode ? portalTools : tools,
    maxSteps: 5,
    onFinish: async ({ text, steps }) => {
      // Persist after the stream completes: the accumulated collected blob plus
      // the appended user + assistant turns. Failures are logged, not thrown,
      // so a persistence hiccup does not corrupt the already-streamed reply.
      //
      // Multi-step flows (e.g. lead-in text → showColorCard tool → stop) emit
      // `text` as only the LAST step's text, which can be empty. Join all step
      // texts so the persisted turn captures the full assistant turn including
      // the lead-in that precedes a card trigger.
      const joinedText = Array.isArray(steps)
        ? steps.map((s) => s.text ?? "").filter((t) => t.trim() !== "").join("\n\n")
        : ""
      const fullText = joinedText || text
      try {
        const now = new Date().toISOString()
        const nextMessages: StoredMessage[] = [
          // Belt-and-braces: scrub prior rows too so any pre-scrub historical
          // transcript rows get cleaned on the next write.
          ...priorMessages.map((m) => ({ ...m, content: scrubEinPatterns(m.content) })),
          { role: "user", content: scrubEinPatterns(message), ts: now },
          { role: "assistant", content: scrubEinPatterns(fullText), ts: now },
        ]

        const { error: saveError } = await supabase
          .from("onboarding_sessions")
          .update({
            collected,
            messages: nextMessages,
            updated_at: now,
          })
          .eq("id", resolvedSessionId)

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
