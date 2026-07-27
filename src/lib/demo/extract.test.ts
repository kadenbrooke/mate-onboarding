import { describe, it, expect, vi, afterEach } from "vitest"
import {
  extractCompanyDataViaPortkey,
  extractCompanyProfile,
  mergeExtracted,
  isUsableName,
} from "./extract"
import * as portkey from "./portkey"

afterEach(() => vi.restoreAllMocks())

describe("extractCompanyDataViaPortkey", () => {
  it("returns {} for null html without calling the model", async () => {
    const spy = vi.spyOn(portkey, "chatComplete")
    const out = await extractCompanyDataViaPortkey(null)
    expect(out).toEqual({})
    expect(spy).not.toHaveBeenCalled()
  })

  it("parses a clean JSON object from the model reply", async () => {
    vi.spyOn(portkey, "chatComplete").mockResolvedValue(
      JSON.stringify({ name: "Acme Plumbing", services: ["drains"] })
    )
    const out = await extractCompanyDataViaPortkey("<html>Acme Plumbing drains</html>")
    expect(out.name).toBe("Acme Plumbing")
    expect(out.services).toEqual(["drains"])
  })

  it("strips code fences before parsing", async () => {
    vi.spyOn(portkey, "chatComplete").mockResolvedValue(
      '```json\n{"name":"Bob HVAC"}\n```'
    )
    const out = await extractCompanyDataViaPortkey("<p>Bob HVAC</p>")
    expect(out.name).toBe("Bob HVAC")
  })

  it("returns {} when the model returns non-JSON (never throws)", async () => {
    vi.spyOn(portkey, "chatComplete").mockResolvedValue("sorry I cannot help")
    const out = await extractCompanyDataViaPortkey("<p>x</p>")
    expect(out).toEqual({})
  })

  it("returns {} when the model returns empty (failure/fallback)", async () => {
    vi.spyOn(portkey, "chatComplete").mockResolvedValue("")
    const out = await extractCompanyDataViaPortkey("<p>x</p>")
    expect(out).toEqual({})
  })
})

describe("isUsableName", () => {
  it("accepts a real business name", () => {
    expect(isUsableName("Acme Plumbing")).toBe(true)
  })
  it("rejects empty/whitespace/non-string", () => {
    expect(isUsableName("")).toBe(false)
    expect(isUsableName("   ")).toBe(false)
    expect(isUsableName(undefined)).toBe(false)
    expect(isUsableName(null)).toBe(false)
  })
  it("rejects generic placeholders", () => {
    for (const n of ["Home", "home", "Welcome", "this business", "Untitled", "Website"]) {
      expect(isUsableName(n), n).toBe(false)
    }
  })
})

describe("mergeExtracted", () => {
  it("prefers a high-confidence metadata name (JSON-LD) over the LLM name", () => {
    const out = mergeExtracted(
      { name: "Acme Plumbing", name_source: "json-ld" },
      { name: "Home" }
    )
    expect(out.name).toBe("Acme Plumbing")
  })
  it("prefers an og:site_name metadata name over the LLM name", () => {
    const out = mergeExtracted(
      { name: "Bright Electric", name_source: "og:site_name" },
      { name: "Some Other Guess" }
    )
    expect(out.name).toBe("Bright Electric")
  })
  it("lets a usable LLM name win over a TITLE-derived metadata name", () => {
    // Real case: title = "Plumbing ... | Mr. Rooter Plumbing" -> title-derived
    // guess is the tagline; the LLM reads the page and gets the real name.
    const out = mergeExtracted(
      { name: "Plumbing & Drain Cleaning Services", name_source: "title" },
      { name: "Mr. Rooter Plumbing" }
    )
    expect(out.name).toBe("Mr. Rooter Plumbing")
  })
  it("falls back to the title-derived name when the LLM has no usable name", () => {
    const out = mergeExtracted(
      { name: "Green Valley Landscaping", name_source: "title" },
      { name: "Home" }
    )
    expect(out.name).toBe("Green Valley Landscaping")
  })
  it("falls back to the LLM name when metadata has no usable name", () => {
    const out = mergeExtracted({ name: "Welcome" }, { name: "Bob HVAC" })
    expect(out.name).toBe("Bob HVAC")
  })
  it("leaves name undefined when neither source is usable", () => {
    const out = mergeExtracted({ name: "Home" }, { name: "" })
    expect(out.name).toBeUndefined()
  })
  it("prefers LLM services, else metadata services", () => {
    expect(mergeExtracted({ services: ["a"] }, { services: ["b"] }).services).toEqual(["b"])
    expect(mergeExtracted({ services: ["a"] }, {}).services).toEqual(["a"])
  })
  it("backfills phone/address/about from metadata when LLM lacks them", () => {
    const out = mergeExtracted(
      { phone: "801-555-0100", address: "1 Main St", description: "We pave." },
      { name: "Acme" }
    )
    expect(out.phone).toBe("801-555-0100")
    expect(out.address).toBe("1 Main St")
    expect(out.about).toBe("We pave.")
  })
})

describe("extractCompanyProfile", () => {
  it("uses JSON-LD name even when the LLM body extract is empty (SPA rescue)", async () => {
    // SPA: LLM sees an empty body and returns {}, but the head has JSON-LD.
    vi.spyOn(portkey, "chatComplete").mockResolvedValue("")
    const html = `<head><script type="application/ld+json">{"@type":"Organization","name":"Roto-Rooter"}</script></head><body><div id="root"></div></body>`
    const out = await extractCompanyProfile(html)
    expect(out.name).toBe("Roto-Rooter")
  })

  it("returns metadata name even when the model returns a generic name", async () => {
    vi.spyOn(portkey, "chatComplete").mockResolvedValue(
      JSON.stringify({ name: "Home" })
    )
    const html = `<head><meta property="og:site_name" content="Bright Electric"></head>`
    const out = await extractCompanyProfile(html)
    expect(out.name).toBe("Bright Electric")
  })

  it("returns no name when head + LLM both yield nothing usable", async () => {
    vi.spyOn(portkey, "chatComplete").mockResolvedValue(JSON.stringify({}))
    const html = `<head><title>Home</title></head>`
    const out = await extractCompanyProfile(html)
    expect(isUsableName(out.name)).toBe(false)
  })
})
