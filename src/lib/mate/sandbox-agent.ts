// Pure prompt builders for the personalized sandbox reveal.
//
// At the end of onboarding, Mate "wakes up" the client's First Responder in a
// SANDBOX using their REAL business name, services, and brand voice (all pulled
// from onboarding_sessions.collected). The owner texts a fake lead on-screen and
// watches their agent reply in their own voice. This is a DEMO: no real phone
// number, no persistence, ephemeral.
//
// These functions are PURE (no I/O, no model call) so they are cheap to unit
// test and safe to run on both server (API route) and client (reveal UI seeds
// the greeting from the same function). The system-prompt shape is adapted from
// the demo-sms-3tr reference agent: one-question-at-a-time SMS qualify style,
// but with the business's real details injected and the cost-first gpt-4o-mini
// model chosen at the call site per .claude/rules/model-agnostic.md.

/**
 * Shape of the fields this module reads out of `collected`. Anything unknown is
 * tolerated (Record index), and every field is optional so an empty or null-ish
 * collected never throws.
 */
type SandboxCollected = {
  company?: { name?: string } | null
  services?: unknown
  brand_voice?: unknown
} & Record<string, unknown>

/** Business name or a neutral fallback. Never throws on missing/null input. */
function businessName(c: SandboxCollected | null | undefined): string {
  const name = c?.company?.name
  return typeof name === "string" && name.trim() !== "" ? name.trim() : "this business"
}

/** Comma-joined service list, or a neutral fallback when none are present. */
function serviceList(c: SandboxCollected | null | undefined): string {
  const raw = c?.services
  if (Array.isArray(raw)) {
    const cleaned = raw
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      .map((s) => s.trim())
    if (cleaned.length > 0) return cleaned.join(", ")
  }
  return "our services"
}

/** Brand voice string, or a neutral professional fallback. */
function brandVoice(c: SandboxCollected | null | undefined): string {
  const voice = c?.brand_voice
  return typeof voice === "string" && voice.trim() !== "" ? voice.trim() : "friendly and professional"
}

/**
 * Build the system prompt for the sandbox First Responder. Personalized with the
 * business's real name, services, and brand voice; falls back to neutral labels
 * for any missing field so the demo always renders.
 */
export function sandboxSystemPrompt(c: Record<string, unknown>): string {
  const coll = c as SandboxCollected | null | undefined
  const name = businessName(coll)
  const services = serviceList(coll)
  const voice = brandVoice(coll)

  return `You are the after-hours text assistant for ${name}. Voice: ${voice}. No em dashes, no emoji.
Reply like SMS: 1-2 short sentences, one question at a time. You handle missed-call text-backs and qualify
leads for: ${services}. Collect name, which service, address, and timeline, then say you'll have ${name}
reach out. This is a DEMO conversation for the owner to see how their agent will sound.`
}

/**
 * The agent's FIRST WORDS: the seeded opening the owner sees in the sandbox.
 * Phase 2 birth amp: the agent introduces ITSELF by its (possibly renamed)
 * name, tied to the business, before the missed-call text-back framing. Pure,
 * no em dashes, no emoji.
 */
export function sandboxGreeting(
  c: Record<string, unknown>,
  agentName?: string | null
): string {
  const name = businessName(c as SandboxCollected | null | undefined)
  const self =
    typeof agentName === "string" && agentName.trim() !== ""
      ? `I'm ${agentName.trim()}, the new assistant for ${name}. `
      : ""
  return `Hi, thanks for calling ${name}! ${self}Sorry we missed you. What can we help you with?`
}
