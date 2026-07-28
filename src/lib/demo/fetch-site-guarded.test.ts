import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock DNS + normalizeUrl so we can drive fetchSiteGuarded without real network/DNS.
const lookupMock = vi.fn()
// Node builtins need a default export on the mock (vitest resolves the CJS
// interop default), or collection fails before any test runs. vi.mock is
// hoisted, so the shape must be built inside the factory (vi.hoisted-safe).
vi.mock("node:dns/promises", () => {
  const shape = { lookup: (...a: unknown[]) => lookupMock(...a) }
  return { ...shape, default: shape }
})
vi.mock("@/lib/research/website", () => ({
  normalizeUrl: (u: string) => (/^https?:\/\//i.test(u) ? u : "https://" + u),
}))

import { fetchSiteGuarded } from "./fetch-site-guarded"

describe("fetchSiteGuarded (H3b SSRF + body cap)", () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    lookupMock.mockReset()
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it("blocks a non-http scheme before any DNS or fetch", async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const r = await fetchSiteGuarded("file:///etc/passwd")
    expect(r.blocked).toBe(true)
    expect(r.html).toBeNull()
    expect(lookupMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("blocks a private-IP literal host without DNS or fetch", async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const r = await fetchSiteGuarded("http://169.254.169.254/latest/meta-data/")
    expect(r.blocked).toBe(true)
    expect(r.reason).toContain("private IP")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("blocks a hostname that RESOLVES to a private IP (DNS-rebinding defense)", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }])
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const r = await fetchSiteGuarded("https://internal.evil.com/")
    expect(r.blocked).toBe(true)
    expect(r.reason).toContain("private IP")
    expect(lookupMock).toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("blocks when the host does not resolve", async () => {
    lookupMock.mockResolvedValue([])
    const r = await fetchSiteGuarded("https://nope.example/")
    expect(r.blocked).toBe(true)
    expect(r.reason).toContain("did not resolve")
  })

  it("blocks when DNS lookup throws", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"))
    const r = await fetchSiteGuarded("https://broken.example/")
    expect(r.blocked).toBe(true)
    expect(r.reason).toContain("DNS resolution failed")
  })

  it("fetches a public host and caps the body size", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
    // Build a streamed body larger than the 2MB cap.
    const big = "<html>" + "a".repeat(3_000_000)
    const bytes = new TextEncoder().encode(big)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Emit in chunks so the reader loop exercises the cap.
        const chunk = 256 * 1024
        for (let i = 0; i < bytes.length; i += chunk) {
          controller.enqueue(bytes.subarray(i, i + chunk))
        }
        controller.close()
      },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200 })
    ) as unknown as typeof fetch

    const r = await fetchSiteGuarded("https://public-site.com/")
    expect(r.blocked).toBeUndefined()
    expect(r.html).not.toBeNull()
    // Capped near 2MB, well under the 3MB payload.
    expect(r.html!.length).toBeLessThanOrEqual(2_000_000)
    expect(r.html!.startsWith("<html>")).toBe(true)
  })

  it("returns html:null (not blocked) on a non-ok upstream response", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 })) as unknown as typeof fetch
    const r = await fetchSiteGuarded("https://public-site.com/")
    expect(r.blocked).toBeUndefined()
    expect(r.html).toBeNull()
  })

  it("uses the bot-honest UA by default and a browser UA on the retry", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("<html>ok", { status: 200 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await fetchSiteGuarded("https://public-site.com/")
    const defaultUa = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(defaultUa["user-agent"]).toContain("MateOnboarding")

    await fetchSiteGuarded("https://public-site.com/", { browserUa: true })
    const browserUa = (fetchSpy.mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(browserUa["user-agent"]).toContain("Chrome")
    expect(browserUa["user-agent"]).not.toContain("MateOnboarding")
  })
})
