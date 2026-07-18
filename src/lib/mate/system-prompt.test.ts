import { describe, it, expect } from "vitest"
import { mateSystemPrompt, type ResearchedCompany } from "./system-prompt"

const rich: ResearchedCompany = {
  name: "Summit Paving",
  services: ["Driveway paving", "Sealcoating"],
  service_area: "Salt Lake County",
  hours: "Mon-Fri 7-5",
  phone: "(385) 555-0100",
  email: "hi@summitpaving.com",
  address: "123 Main St, Orem UT",
  published_channels: ["Google Business", "Facebook"],
}

describe("mateSystemPrompt", () => {
  it("quotes researched data so Mate can confirm, not ask blind", () => {
    const p = mateSystemPrompt("Summit Mate", rich)
    expect(p).toContain("Summit Paving")
    expect(p).toContain("Driveway paving")
    expect(p).toContain("Salt Lake County")
    expect(p).toContain("(385) 555-0100")
    expect(p).toContain("Google Business")
    // Instructs confirm-first behavior.
    expect(p.toLowerCase()).toContain("confirm")
  })

  it("names the mate and business", () => {
    const p = mateSystemPrompt("Buddy", rich)
    expect(p).toContain("You are Buddy")
    expect(p).toContain("Summit Paving")
  })

  it("defines the four required fields to finish", () => {
    const p = mateSystemPrompt("Mate", rich)
    for (const key of [
      "services",
      "brand_voice",
      "current_phone",
      "lead_delivery_phone",
    ]) {
      expect(p).toContain(key)
    }
  })

  it("educates about the abilities (First Responder, follow-up, reactivation, reviews)", () => {
    const p = mateSystemPrompt("Mate", rich)
    expect(p.toLowerCase()).toContain("missed-call text-back")
    expect(p.toLowerCase()).toContain("follow-up")
    expect(p.toLowerCase()).toContain("reactivat")
    expect(p.toLowerCase()).toContain("review")
  })

  it("tells the client they will review everything next", () => {
    const p = mateSystemPrompt("Mate", rich)
    expect(p.toLowerCase()).toContain("review")
  })

  it("falls back to asking from scratch when no research was found", () => {
    const p = mateSystemPrompt("Mate", {})
    expect(p.toLowerCase()).toContain("could not pull much")
    expect(p).toContain("this business")
  })

  it("stays white-label and clean: no em dash, no parent-company name", () => {
    const p = mateSystemPrompt("Mate", rich)
    expect(p).not.toContain("—") // em dash
    expect(p).not.toMatch(/auto mate/i)
    expect(p).not.toMatch(/anthropic|kaden/i)
  })

  it("appends a live-capabilities line only when a real summary is given", () => {
    const withCaps = mateSystemPrompt("Mate", rich, "You can currently: Reviews.")
    expect(withCaps).toContain("What you can do for this business right now")
    const naCaps = mateSystemPrompt("Mate", rich, "na")
    expect(naCaps).not.toContain("What you can do for this business right now")
    const emptyCaps = mateSystemPrompt("Mate", rich)
    expect(emptyCaps).not.toContain("What you can do for this business right now")
  })

  it("includes only researched lines, omitting fields that were not found", () => {
    const p = mateSystemPrompt("Mate", { name: "Acme", services: ["Roofing"] })
    expect(p).toContain("Acme")
    expect(p).toContain("Roofing")
    // No email/address/phone lines when those were not researched.
    expect(p).not.toContain("Email on site:")
    expect(p).not.toContain("Address:")
    expect(p).not.toContain("Phone on site:")
  })

  it("instructs present-and-verify: present found info, never ask for it", () => {
    const p = mateSystemPrompt("Mate", rich)
    const lower = p.toLowerCase()
    // Explicitly tells Mate to present/verify rather than ask for known info.
    expect(lower).toContain("present")
    expect(lower).toContain("verify")
    // Directive against re-asking for researched info.
    expect(lower).toMatch(/never ask for (a piece of )?info(rmation)? .*(found|research)/)
  })

  it("groups presentation into a contact block and a services block", () => {
    const p = mateSystemPrompt("Mate", rich)
    const lower = p.toLowerCase()
    expect(lower).toContain("contact")
    expect(lower).toContain("services")
    // The 'look right?' / confirm-then-save framing of the contact block.
    expect(lower).toMatch(/look right|fix anything|correct anything/)
  })

  it("distinguishes current_phone (found, present it) from lead_delivery_phone (ask for it)", () => {
    const p = mateSystemPrompt("Mate", rich)
    const lower = p.toLowerCase()
    // current_phone is presented (found on site); lead_delivery_phone is asked.
    expect(p).toContain("current_phone")
    expect(p).toContain("lead_delivery_phone")
    // The warm-lead cell is framed as the thing to ASK for.
    expect(lower).toContain("warm lead")
  })

  it("frames brand voice and the warm-lead cell as the only genuine gaps to ask", () => {
    const p = mateSystemPrompt("Mate", rich)
    const lower = p.toLowerCase()
    expect(lower).toContain("brand voice")
    // Only ask what research can't derive.
    expect(lower).toMatch(/only ask|genuinely missing|genuine gap/)
  })
})
