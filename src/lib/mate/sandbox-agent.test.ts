import { describe, it, expect } from "vitest"
import { sandboxSystemPrompt, sandboxGreeting } from "./sandbox-agent"

describe("sandboxSystemPrompt", () => {
  it("embeds the business name, services, and brand voice", () => {
    const p = sandboxSystemPrompt({
      company: { name: "J&C Asphalt" },
      services: ["driveway", "sealcoat"],
      brand_voice: "friendly and warm",
    })
    expect(p).toContain("J&C Asphalt")
    expect(p).toContain("driveway")
    expect(p).toContain("friendly and warm")
  })

  it("falls back gracefully on empty collected (no throw, generic labels)", () => {
    expect(() => sandboxSystemPrompt({})).not.toThrow()
    const p = sandboxSystemPrompt({})
    expect(p).toContain("this business")
    // Generic fallbacks fill in for the missing fields.
    expect(p).toContain("our services")
    expect(p).toContain("friendly and professional")
  })

  it("tolerates a fully undefined/null-ish collected without throwing", () => {
    // Defensive: the API route loads collected from the DB and it could be null.
    expect(() => sandboxSystemPrompt(undefined as unknown as Record<string, unknown>)).not.toThrow()
    expect(() => sandboxSystemPrompt(null as unknown as Record<string, unknown>)).not.toThrow()
    expect(sandboxSystemPrompt(null as unknown as Record<string, unknown>)).toContain("this business")
  })

  it("carries the demo/voice hard rules (no em dashes, no emoji, one question at a time)", () => {
    const p = sandboxSystemPrompt({ company: { name: "Acme" } })
    expect(p).toContain("No em dashes")
    expect(p.toLowerCase()).toContain("one question at a time")
    // It is honest that this is a demo the owner is watching.
    expect(p.toLowerCase()).toContain("demo")
  })
})

describe("sandboxGreeting", () => {
  it("returns a missed-call text-back containing the business name", () => {
    const g = sandboxGreeting({ company: { name: "J&C Asphalt" } })
    expect(g).toContain("J&C Asphalt")
  })

  it("falls back to a generic label when no business name is present", () => {
    expect(() => sandboxGreeting({})).not.toThrow()
    const g = sandboxGreeting({})
    expect(g).toContain("this business")
  })

  it("never contains an em dash", () => {
    const g = sandboxGreeting({ company: { name: "Acme Plumbing" } })
    expect(g).not.toContain("—")
  })
})
