import { describe, it, expect } from "vitest"
import {
  extractBrandFromHtml,
  extractCompanyData,
  extractBrandColorsFromMarkup,
  normalizeUrl,
} from "./website"

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

  it("prefers a real raster (apple-touch-icon png) over a .ico favicon for the palette source, but still exposes a logo_url", () => {
    const html = `
      <link rel="icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="/icons/touch.png">
    `
    const b = extractBrandFromHtml(html, "https://x.com")
    // logo_url is the raster we can actually decode.
    expect(b.logo_url).toBe("https://x.com/icons/touch.png")
    // and the raw-icon (.ico) should be exposed for display fallback.
    expect(b.icon_url).toBe("https://x.com/favicon.ico")
    // palette_logo_url is what we feed sharp: never the .ico.
    expect(b.palette_logo_url).toBe("https://x.com/icons/touch.png")
  })

  it("does NOT feed a .ico favicon to the palette (palette_logo_url null), but keeps it as a display logo_url", () => {
    const html = `<link rel="icon" href="/favicon.ico">`
    const b = extractBrandFromHtml(html, "https://x.com")
    expect(b.logo_url).toBe("https://x.com/favicon.ico")
    expect(b.palette_logo_url).toBeNull()
  })

  it("does NOT feed an .svg logo to the palette (palette_logo_url null), but keeps it as a display logo_url", () => {
    const html = `<link rel="icon" href="/logo.svg">`
    const b = extractBrandFromHtml(html, "https://x.com")
    expect(b.logo_url).toBe("https://x.com/logo.svg")
    expect(b.palette_logo_url).toBeNull()
  })

  it("uses og:image as the palette logo when present (real raster)", () => {
    const html = `
      <meta property="og:image" content="https://x.com/og.jpg">
      <link rel="icon" href="/favicon.ico">
    `
    const b = extractBrandFromHtml(html, "https://x.com")
    expect(b.palette_logo_url).toBe("https://x.com/og.jpg")
    // og:image is a substantial brand image, NOT icon-class.
    expect(b.palette_logo_is_icon_class).toBe(false)
  })

  it("flags an apple-touch-icon raster as icon-class (weaker palette signal than CSS)", () => {
    const html = `<link rel="apple-touch-icon" href="/apple-icon.png">`
    const b = extractBrandFromHtml(html, "https://x.com")
    expect(b.palette_logo_url).toBe("https://x.com/apple-icon.png")
    expect(b.palette_logo_is_icon_class).toBe(true)
  })
})

describe("extractBrandColorsFromMarkup", () => {
  it("returns an orange primary from inline style + <style> block with repeated #e14d1a", async () => {
    const html = `
      <html>
        <head>
          <style>
            .cta { background: #e14d1a; }
            .header { border-bottom: 4px solid #e14d1a; }
            body { background: #ffffff; color: #141414; }
          </style>
        </head>
        <body style="--accent: #e14d1a;">
          <a style="color:#e14d1a">Call now</a>
        </body>
      </html>
    `
    const p = await extractBrandColorsFromMarkup(html, "https://x.com")
    expect(p).not.toBeNull()
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(p!.primary)
    const r = parseInt(m![1], 16)
    const b = parseInt(m![3], 16)
    expect(r).toBeGreaterThan(b) // orange: red dominant
  })

  it("returns null for a page of only greys / white / black", async () => {
    const html = `
      <style>
        body { background: #ffffff; color: #000000; }
        .card { background: #f5f5f5; }
        .muted { color: #888888; }
      </style>
    `
    const p = await extractBrandColorsFromMarkup(html, "https://x.com")
    expect(p).toBeNull()
  })
})

describe("extractCompanyData", () => {
  it("resolves to {} for null html without any network call", async () => {
    const data = await extractCompanyData(null)
    expect(data).toEqual({})
  })
})
