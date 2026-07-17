import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { derivePalette } from "./palette"

const DEFAULT_COLORS = {
  primary: "#1f2937",
  bg: "#ffffff",
  accent: "#2563eb",
} as const

export function normalizeUrl(input: string): string {
  let u = input.trim()
  if (!/^https?:\/\//i.test(u)) u = "https://" + u
  return u.replace(/\/+$/, "")
}

function resolve(base: string, href: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

/** Where a brand's colors ultimately came from, so the caller can tell. */
export type BrandColorSource = "logo" | "theme-color" | "manifest" | "default"

export interface Brand {
  logo_url: string | null
  colors: {
    primary: string
    bg: string
    accent: string
    source: BrandColorSource
  }
}

export function extractBrandFromHtml(html: string, baseUrl: string): Brand {
  const pick = (re: RegExp) => (html.match(re)?.[1] ?? "").trim()
  const logoRaw =
    pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
  const themeColor = pick(
    /<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,8})["']/i
  )

  const colors = themeColor
    ? { ...DEFAULT_COLORS, primary: themeColor, source: "theme-color" as const }
    : { ...DEFAULT_COLORS, source: "default" as const }

  return {
    logo_url: logoRaw ? resolve(baseUrl, logoRaw) : null,
    colors,
  }
}

export async function fetchSite(
  url: string
): Promise<{ html: string | null; finalUrl: string }> {
  const finalUrl = normalizeUrl(url)
  try {
    const res = await fetch(finalUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MateOnboarding/1.0)" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { html: null, finalUrl }
    return { html: await res.text(), finalUrl }
  } catch {
    return { html: null, finalUrl }
  }
}

/**
 * Fetch an image URL into a Buffer. Never throws; returns null on any failure,
 * timeout, non-image, or absurd payload so callers can fall through the source
 * chain. Handles data: URLs inline (no network round-trip).
 */
export async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) {
      // data:[<mediatype>][;base64],<data>
      const comma = url.indexOf(",")
      if (comma === -1) return null
      const meta = url.slice(5, comma)
      const payload = url.slice(comma + 1)
      if (/;base64/i.test(meta)) {
        return Buffer.from(payload, "base64")
      }
      return Buffer.from(decodeURIComponent(payload), "utf8")
    }

    if (!/^https?:\/\//i.test(url)) return null

    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MateOnboarding/1.0)" },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null

    const type = res.headers.get("content-type") ?? ""
    // Best-effort guard: skip obvious non-images (SVG is fine, sharp reads it).
    if (type && !/^image\//i.test(type) && !type.includes("octet-stream")) {
      return null
    }

    const ab = await res.arrayBuffer()
    // Guard against absurd payloads (10MB cap).
    if (ab.byteLength === 0 || ab.byteLength > 10_000_000) return null
    return Buffer.from(ab)
  } catch {
    return null
  }
}

/**
 * Best-effort read of a linked web app manifest's theme_color.
 * Returns a "#rrggbb"-ish string or null. Never throws.
 */
async function fetchManifestThemeColor(
  html: string,
  baseUrl: string
): Promise<string | null> {
  try {
    const href = (
      html.match(
        /<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/i
      )?.[1] ?? ""
    ).trim()
    if (!href) return null

    const manifestUrl = resolve(baseUrl, href)
    if (!/^https?:\/\//i.test(manifestUrl)) return null

    const res = await fetch(manifestUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MateOnboarding/1.0)" },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null

    const json = (await res.json()) as { theme_color?: unknown }
    const color =
      typeof json.theme_color === "string" ? json.theme_color.trim() : ""
    return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : null
  } catch {
    return null
  }
}

/**
 * Resolve a brand's colors through a preference chain, first success wins:
 *   1. logo image  -> derivePalette (pure sharp math, no model)
 *   2. <meta name="theme-color">   (already parsed into base.colors)
 *   3. web manifest theme_color    (best-effort fetch)
 *   4. hardcoded neutral defaults  (LAST)
 *
 * `base` is the Brand produced by extractBrandFromHtml; its logo_url and any
 * theme-color it already found are reused. Never throws.
 */
export async function resolveBrandColors(
  base: Brand,
  html: string,
  baseUrl: string
): Promise<Brand> {
  // 1. Logo-derived palette.
  if (base.logo_url) {
    const buf = await fetchImageBuffer(base.logo_url)
    if (buf) {
      try {
        const palette = await derivePalette(buf)
        return {
          logo_url: base.logo_url,
          colors: { ...palette, source: "logo" },
        }
      } catch {
        // derivePalette is itself non-throwing, but stay defensive.
      }
    }
  }

  // 2. theme-color meta (extractBrandFromHtml already applied it).
  if (base.colors.source === "theme-color") {
    return base
  }

  // 3. web manifest theme_color.
  const manifestColor = await fetchManifestThemeColor(html, baseUrl)
  if (manifestColor) {
    return {
      logo_url: base.logo_url,
      colors: { ...DEFAULT_COLORS, primary: manifestColor, source: "manifest" },
    }
  }

  // 4. neutral defaults (base already carries source: "default").
  return base
}

export interface CompanyData {
  name?: string
  services?: string[]
  hours?: string
  service_area?: string
  phone?: string
  about?: string
  email?: string
  address?: string
  social?: string[]
  published_channels?: string[]
}

export async function extractCompanyData(html: string | null): Promise<CompanyData> {
  if (!html) return {}
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .slice(0, 8000)

  // Lazy-init the model client inside the handler (never at module scope), so a
  // missing OPENAI key at build/import time can't break the app.
  try {
    const { text: json } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: [
        "Extract company info from the website text below as a single JSON object.",
        "Keys (all optional, omit if truly unknown):",
        "  name: string",
        "  services: string[] (the services/offerings the business provides)",
        "  hours: string (business hours, human-readable)",
        "  service_area: string (cities/regions served)",
        "  phone: string",
        "  email: string",
        "  address: string (full street address if present)",
        "  social: string[] (full URLs to social/business profiles: Facebook, Instagram, Yelp, Google Business, LinkedIn, X/Twitter, etc.)",
        '  published_channels: string[] (which platforms the site links to, e.g. "Google Business", "Facebook", "Instagram", "Yelp")',
        "Do not invent values. Return ONLY the JSON object, no prose, no code fences.",
        "",
        "Website text:",
        text,
      ].join("\n"),
    })
    return JSON.parse(json.replace(/```json|```/g, "").trim()) as CompanyData
  } catch {
    return {}
  }
}
