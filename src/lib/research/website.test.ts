import { describe, it, expect } from "vitest"
import { extractBrandFromHtml, extractCompanyData, normalizeUrl } from "./website"

describe("normalizeUrl", () => {
  it("adds https and strips trailing slash", () => {
    expect(normalizeUrl("jcasphalt.com/")).toBe("https://jcasphalt.com")
    expect(normalizeUrl("http://x.com")).toBe("http://x.com")
  })
})

describe("extractBrandFromHtml", () => {
  it("pulls og:image as logo and theme-color as primary", () => {
    const html = `<meta property="og:image" content="https://x.com/logo.png">
      <meta name="theme-color" content="#e14d1a">`
    const b = extractBrandFromHtml(html, "https://x.com")
    expect(b.logo_url).toBe("https://x.com/logo.png")
    expect(b.colors.primary).toBe("#e14d1a")
    expect(b.colors.source).toBe("theme-color")
  })

  it("resolves relative logo paths against the base url", () => {
    const html = `<link rel="icon" href="/favicon.png">`
    const b = extractBrandFromHtml(html, "https://x.com")
    expect(b.logo_url).toBe("https://x.com/favicon.png")
  })

  it("returns null logo + default colors (source=default) when nothing found", () => {
    const b = extractBrandFromHtml("<html></html>", "https://x.com")
    expect(b.logo_url).toBeNull()
    expect(b.colors.primary).toBeTruthy()
    expect(b.colors.source).toBe("default")
  })
})

describe("extractCompanyData", () => {
  it("resolves to {} for null html without any network call", async () => {
    const data = await extractCompanyData(null)
    expect(data).toEqual({})
  })
})
