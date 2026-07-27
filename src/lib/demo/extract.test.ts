import { describe, it, expect, vi, afterEach } from "vitest"
import { extractCompanyDataViaPortkey } from "./extract"
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
